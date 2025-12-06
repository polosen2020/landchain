const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("LandRegistry", function () {
  let landRegistry;
  let admin, citizen1, citizen2, verifier;

  beforeEach(async function () {
    [admin, citizen1, citizen2, verifier] = await ethers.getSigners();

    const LandRegistry = await ethers.getContractFactory("LandRegistry");
    landRegistry = await LandRegistry.deploy();
    await landRegistry.deployed();
  });

  describe("Deployment", function () {
    it("Should set the deployer as admin", async function () {
      const user = await landRegistry.users(admin.address);
      expect(user.role).to.equal(2); // Admin role
      expect(user.isActive).to.equal(true);
    });

    it("Should initialize land counter to 0", async function () {
      expect(await landRegistry.landCounter()).to.equal(0);
    });
  });

  describe("User Management", function () {
    it("Should allow admin to register new users", async function () {
      await landRegistry.registerUser(citizen1.address, "John Doe", 0);
      
      const user = await landRegistry.users(citizen1.address);
      expect(user.name).to.equal("John Doe");
      expect(user.role).to.equal(0); // Citizen
      expect(user.isActive).to.equal(true);
    });

    it("Should not allow non-admin to register users", async function () {
      await expect(
        landRegistry.connect(citizen1).registerUser(citizen2.address, "Jane Doe", 0)
      ).to.be.revertedWith("Only admin can perform this action");
    });

    it("Should not allow duplicate user registration", async function () {
      await landRegistry.registerUser(citizen1.address, "John Doe", 0);
      
      await expect(
        landRegistry.registerUser(citizen1.address, "John Doe", 0)
      ).to.be.revertedWith("User already registered");
    });

    it("Should allow admin to change user roles", async function () {
      await landRegistry.registerUser(citizen1.address, "John Doe", 0);
      await landRegistry.changeUserRole(citizen1.address, 1); // Change to Verifier
      
      const user = await landRegistry.users(citizen1.address);
      expect(user.role).to.equal(1);
    });

    it("Should allow admin to deactivate users", async function () {
      await landRegistry.registerUser(citizen1.address, "John Doe", 0);
      await landRegistry.deactivateUser(citizen1.address);
      
      const user = await landRegistry.users(citizen1.address);
      expect(user.isActive).to.equal(false);
    });
  });

  describe("Land Registration", function () {
    beforeEach(async function () {
      await landRegistry.registerUser(citizen1.address, "John Doe", 0);
    });

    it("Should allow citizen to register land", async function () {
      const tx = await landRegistry.connect(citizen1).registerLand(
        "SN12345",
        "123 Main St",
        1000,
        "QmHash123"
      );

      const receipt = await tx.wait();
      const landId = receipt.events[0].args.landId;

      const land = await landRegistry.lands(landId);
      expect(land.surveyNumber).to.equal("SN12345");
      expect(land.location).to.equal("123 Main St");
      expect(land.area).to.equal(1000);
      expect(land.currentOwner).to.equal(citizen1.address);
      expect(land.status).to.equal(0); // Pending
    });

    it("Should not allow duplicate survey numbers", async function () {
      await landRegistry.connect(citizen1).registerLand(
        "SN12345",
        "123 Main St",
        1000,
        "QmHash123"
      );

      await expect(
        landRegistry.connect(citizen1).registerLand(
          "SN12345",
          "456 Oak Ave",
          2000,
          "QmHash456"
        )
      ).to.be.revertedWith("Survey number already exists");
    });

    it("Should not allow duplicate document hashes", async function () {
      await landRegistry.connect(citizen1).registerLand(
        "SN12345",
        "123 Main St",
        1000,
        "QmHash123"
      );

      await expect(
        landRegistry.connect(citizen1).registerLand(
          "SN67890",
          "456 Oak Ave",
          2000,
          "QmHash123"
        )
      ).to.be.revertedWith("Document already uploaded");
    });

    it("Should require area greater than 0", async function () {
      await expect(
        landRegistry.connect(citizen1).registerLand(
          "SN12345",
          "123 Main St",
          0,
          "QmHash123"
        )
      ).to.be.revertedWith("Area must be greater than 0");
    });

    it("Should create ownership history on registration", async function () {
      const tx = await landRegistry.connect(citizen1).registerLand(
        "SN12345",
        "123 Main St",
        1000,
        "QmHash123"
      );

      const receipt = await tx.wait();
      const landId = receipt.events[0].args.landId;

      const history = await landRegistry.getLandHistory(landId);
      expect(history.length).to.equal(1);
      expect(history[0].newOwner).to.equal(citizen1.address);
    });
  });

  describe("Land Verification", function () {
    let landId;

    beforeEach(async function () {
      await landRegistry.registerUser(citizen1.address, "John Doe", 0);
      await landRegistry.registerUser(verifier.address, "Verifier", 1);

      const tx = await landRegistry.connect(citizen1).registerLand(
        "SN12345",
        "123 Main St",
        1000,
        "QmHash123"
      );
      const receipt = await tx.wait();
      landId = receipt.events[0].args.landId;
    });

    it("Should allow verifier to approve land", async function () {
      await landRegistry.connect(verifier).verifyLand(landId, 1); // Approved

      const land = await landRegistry.lands(landId);
      expect(land.status).to.equal(1);
    });

    it("Should allow verifier to reject land", async function () {
      await landRegistry.connect(verifier).verifyLand(landId, 2); // Rejected

      const land = await landRegistry.lands(landId);
      expect(land.status).to.equal(2);
    });

    it("Should allow admin to verify land", async function () {
      await landRegistry.connect(admin).verifyLand(landId, 1);

      const land = await landRegistry.lands(landId);
      expect(land.status).to.equal(1);
    });

    it("Should not allow citizen to verify land", async function () {
      await expect(
        landRegistry.connect(citizen1).verifyLand(landId, 1)
      ).to.be.revertedWith("Only verifier or admin can perform this action");
    });

    it("Should not allow verifying already verified land", async function () {
      await landRegistry.connect(verifier).verifyLand(landId, 1);

      await expect(
        landRegistry.connect(verifier).verifyLand(landId, 1)
      ).to.be.revertedWith("Land already verified");
    });
  });

  describe("Ownership Transfer", function () {
    let landId;

    beforeEach(async function () {
      await landRegistry.registerUser(citizen1.address, "John Doe", 0);
      await landRegistry.registerUser(citizen2.address, "Jane Smith", 0);
      await landRegistry.registerUser(verifier.address, "Verifier", 1);

      const tx = await landRegistry.connect(citizen1).registerLand(
        "SN12345",
        "123 Main St",
        1000,
        "QmHash123"
      );
      const receipt = await tx.wait();
      landId = receipt.events[0].args.landId;

      // Approve the land
      await landRegistry.connect(verifier).verifyLand(landId, 1);
    });

    it("Should allow owner to transfer land", async function () {
      await landRegistry.connect(citizen1).transferOwnership(
        landId,
        citizen2.address,
        "QmTransferHash"
      );

      const land = await landRegistry.lands(landId);
      expect(land.currentOwner).to.equal(citizen2.address);
    });

    it("Should not allow non-owner to transfer land", async function () {
      await expect(
        landRegistry.connect(citizen2).transferOwnership(
          landId,
          citizen2.address,
          "QmTransferHash"
        )
      ).to.be.revertedWith("Only current owner can transfer");
    });

    it("Should not allow transfer of unapproved land", async function () {
      // Register new land (pending status)
      const tx = await landRegistry.connect(citizen1).registerLand(
        "SN67890",
        "456 Oak Ave",
        2000,
        "QmHash456"
      );
      const receipt = await tx.wait();
      const newLandId = receipt.events[0].args.landId;

      await expect(
        landRegistry.connect(citizen1).transferOwnership(
          newLandId,
          citizen2.address,
          "QmTransferHash2"
        )
      ).to.be.revertedWith("Land must be approved");
    });

    it("Should not allow transfer to self", async function () {
      await expect(
        landRegistry.connect(citizen1).transferOwnership(
          landId,
          citizen1.address,
          "QmTransferHash"
        )
      ).to.be.revertedWith("Cannot transfer to self");
    });

    it("Should update ownership history on transfer", async function () {
      await landRegistry.connect(citizen1).transferOwnership(
        landId,
        citizen2.address,
        "QmTransferHash"
      );

      const history = await landRegistry.getLandHistory(landId);
      expect(history.length).to.equal(2);
      expect(history[1].previousOwner).to.equal(citizen1.address);
      expect(history[1].newOwner).to.equal(citizen2.address);
    });

    it("Should not allow reuse of transfer documents", async function () {
      await landRegistry.connect(citizen1).transferOwnership(
        landId,
        citizen2.address,
        "QmTransferHash"
      );

      // Register another land for citizen2
      await landRegistry.connect(citizen2).registerLand(
        "SN67890",
        "456 Oak Ave",
        2000,
        "QmHash456"
      );

      await expect(
        landRegistry.connect(citizen2).transferOwnership(
          landId,
          citizen1.address,
          "QmTransferHash" // Same hash
        )
      ).to.be.revertedWith("Transfer document already used");
    });
  });

  describe("View Functions", function () {
    let landId;

    beforeEach(async function () {
      await landRegistry.registerUser(citizen1.address, "John Doe", 0);

      const tx = await landRegistry.connect(citizen1).registerLand(
        "SN12345",
        "123 Main St",
        1000,
        "QmHash123"
      );
      const receipt = await tx.wait();
      landId = receipt.events[0].args.landId;
    });

    it("Should return land details", async function () {
      const details = await landRegistry.getLandDetails(landId);
      
      expect(details.surveyNumber).to.equal("SN12345");
      expect(details.location).to.equal("123 Main St");
      expect(details.area).to.equal(1000);
      expect(details.currentOwner).to.equal(citizen1.address);
    });

    it("Should return user role", async function () {
      const role = await landRegistry.getUserRole(citizen1.address);
      expect(role).to.equal(0); // Citizen
    });

    it("Should return total lands count", async function () {
      expect(await landRegistry.getTotalLands()).to.equal(1);

      await landRegistry.connect(citizen1).registerLand(
        "SN67890",
        "456 Oak Ave",
        2000,
        "QmHash456"
      );

      expect(await landRegistry.getTotalLands()).to.equal(2);
    });
  });

  describe("Events", function () {
    it("Should emit UserRegistered event", async function () {
      await expect(
        landRegistry.registerUser(citizen1.address, "John Doe", 0)
      ).to.emit(landRegistry, "UserRegistered")
        .withArgs(citizen1.address, 0, "John Doe");
    });

    it("Should emit LandRegistered event", async function () {
      await landRegistry.registerUser(citizen1.address, "John Doe", 0);

      await expect(
        landRegistry.connect(citizen1).registerLand(
          "SN12345",
          "123 Main St",
          1000,
          "QmHash123"
        )
      ).to.emit(landRegistry, "LandRegistered");
    });

    it("Should emit LandVerified event", async function () {
      await landRegistry.registerUser(citizen1.address, "John Doe", 0);
      await landRegistry.registerUser(verifier.address, "Verifier", 1);

      const tx = await landRegistry.connect(citizen1).registerLand(
        "SN12345",
        "123 Main St",
        1000,
        "QmHash123"
      );
      const receipt = await tx.wait();
      const landId = receipt.events[0].args.landId;

      await expect(
        landRegistry.connect(verifier).verifyLand(landId, 1)
      ).to.emit(landRegistry, "LandVerified")
        .withArgs(landId, 1, verifier.address);
    });
  });
});