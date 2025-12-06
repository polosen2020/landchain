// scripts/deploy.js
const hre = require("hardhat");
const fs = require('fs');

async function main() {
  console.log("Starting LandRegistry deployment...");

  // Get the contract factory
  const LandRegistry = await hre.ethers.getContractFactory("LandRegistry");
  
  // Deploy the contract
  console.log("Deploying LandRegistry contract...");
  const landRegistry = await LandRegistry.deploy();
  
  // Wait for deployment to complete (ethers v6 syntax)
  await landRegistry.waitForDeployment();
  
  // Get the contract address (ethers v6 syntax)
  const contractAddress = await landRegistry.getAddress();
  
  console.log("✅ LandRegistry deployed to:", contractAddress);
  
  // Get the deployer address
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deployed by:", deployer.address);
  console.log("Admin address:", deployer.address);
  
  // Verify admin role
  const adminRole = await landRegistry.getUserRole(deployer.address);
  console.log("Admin role confirmed:", adminRole === 2n); // BigInt comparison in ethers v6
  
  // Save deployment info
  const deploymentInfo = {
    contractAddress: contractAddress,
    deployer: deployer.address,
    network: hre.network.name,
    timestamp: new Date().toISOString()
  };
  
  fs.writeFileSync(
    'deployment-info.json',
    JSON.stringify(deploymentInfo, null, 2)
  );
  
  console.log("\n📝 Deployment info saved to deployment-info.json");
  
  // Save ABI
  const artifact = await hre.artifacts.readArtifact("LandRegistry");
  fs.writeFileSync(
    'LandRegistryABI.json',
    JSON.stringify(artifact.abi, null, 2)
  );
  
  console.log("📝 ABI saved to LandRegistryABI.json");
  
  console.log("\n🎉 Deployment completed successfully!");
  console.log("\n📋 Next steps:");
  console.log("1. Copy this contract address: " + contractAddress);
  console.log("2. Update CONTRACT_ADDRESS in backend/.env file");
  console.log("3. Update CONTRACT_ADDRESS in frontend/index.html");
  console.log("4. Copy LandRegistryABI.json to backend folder");
  console.log("5. Start IPFS daemon: ipfs daemon");
  console.log("6. Start backend: cd backend && npm start");
  console.log("7. Open frontend in browser");
  
  console.log("\n⚠️  IMPORTANT: Save these addresses!");
  console.log("Contract:", contractAddress);
  console.log("Admin:", deployer.address);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });