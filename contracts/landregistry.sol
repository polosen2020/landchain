// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

contract LandRegistry {
    // Roles
    address public admin;
    
    enum Role { Citizen, Verifier, Admin }
    enum Status { Pending, Approved, Rejected }
    
    struct User {
        address userAddress;
        Role role;
        string name;
        bool isActive;
    }
    
    struct Land {
        uint256 landId;
        string surveyNumber;
        string location;
        uint256 area;
        address currentOwner;
        Status status;
        uint256 registrationDate;
        string ipfsHash;
        bool exists;
    }
    
    struct OwnershipHistory {
        address previousOwner;
        address newOwner;
        uint256 transferDate;
        string ipfsDocHash;
    }
    
    // State variables
    mapping(address => User) public users;
    mapping(uint256 => Land) public lands;
    mapping(uint256 => OwnershipHistory[]) public landHistory;
    mapping(string => bool) public surveyNumberExists;
    mapping(string => bool) public documentHashExists;
    
    uint256 public landCounter;
    
    // Events
    event UserRegistered(address indexed userAddress, Role role, string name);
    event LandRegistered(uint256 indexed landId, address indexed owner, string surveyNumber);
    event LandVerified(uint256 indexed landId, Status status, address indexed verifier);
    event OwnershipTransferred(uint256 indexed landId, address indexed from, address indexed to);
    event RoleChanged(address indexed userAddress, Role newRole);
    
    // Modifiers
    modifier onlyAdmin() {
        require(users[msg.sender].role == Role.Admin, "Only admin can perform this action");
        require(users[msg.sender].isActive, "User is not active");
        _;
    }
    
    modifier onlyVerifier() {
        require(users[msg.sender].role == Role.Verifier || users[msg.sender].role == Role.Admin, 
                "Only verifier or admin can perform this action");
        require(users[msg.sender].isActive, "User is not active");
        _;
    }
    
    modifier onlyCitizen() {
        require(users[msg.sender].isActive, "User is not active");
        _;
    }
    
    modifier landExists(uint256 _landId) {
        require(lands[_landId].exists, "Land does not exist");
        _;
    }
    
    constructor() {
        admin = msg.sender;
        users[msg.sender] = User(msg.sender, Role.Admin, "System Admin", true);
        emit UserRegistered(msg.sender, Role.Admin, "System Admin");
    }
    
    // User Management
    function registerUser(address _userAddress, string memory _name, Role _role) public onlyAdmin {
        require(!users[_userAddress].isActive, "User already registered");
        require(_userAddress != address(0), "Invalid address");
        
        users[_userAddress] = User(_userAddress, _role, _name, true);
        emit UserRegistered(_userAddress, _role, _name);
    }
    
    function changeUserRole(address _userAddress, Role _newRole) public onlyAdmin {
        require(users[_userAddress].isActive, "User not found");
        require(_userAddress != admin, "Cannot change admin role");
        
        users[_userAddress].role = _newRole;
        emit RoleChanged(_userAddress, _newRole);
    }
    
    function deactivateUser(address _userAddress) public onlyAdmin {
        require(_userAddress != admin, "Cannot deactivate admin");
        users[_userAddress].isActive = false;
    }
    
    // Land Registration
    function registerLand(
        string memory _surveyNumber,
        string memory _location,
        uint256 _area,
        string memory _ipfsHash
    ) public onlyCitizen returns (uint256) {
        require(!surveyNumberExists[_surveyNumber], "Survey number already exists");
        require(!documentHashExists[_ipfsHash], "Document already uploaded");
        require(_area > 0, "Area must be greater than 0");
        require(bytes(_surveyNumber).length > 0, "Survey number required");
        
        landCounter++;
        
        lands[landCounter] = Land({
            landId: landCounter,
            surveyNumber: _surveyNumber,
            location: _location,
            area: _area,
            currentOwner: msg.sender,
            status: Status.Pending,
            registrationDate: block.timestamp,
            ipfsHash: _ipfsHash,
            exists: true
        });
        
        surveyNumberExists[_surveyNumber] = true;
        documentHashExists[_ipfsHash] = true;
        
        // Add initial history entry
        landHistory[landCounter].push(OwnershipHistory({
            previousOwner: address(0),
            newOwner: msg.sender,
            transferDate: block.timestamp,
            ipfsDocHash: _ipfsHash
        }));
        
        emit LandRegistered(landCounter, msg.sender, _surveyNumber);
        return landCounter;
    }
    
    // Verification
    function verifyLand(uint256 _landId, Status _status) public onlyVerifier landExists(_landId) {
        require(_status == Status.Approved || _status == Status.Rejected, "Invalid status");
        require(lands[_landId].status == Status.Pending, "Land already verified");
        
        lands[_landId].status = _status;
        emit LandVerified(_landId, _status, msg.sender);
    }
    
    // Ownership Transfer
    function transferOwnership(
        uint256 _landId,
        address _newOwner,
        string memory _transferDocHash
    ) public onlyCitizen landExists(_landId) {
        require(lands[_landId].currentOwner == msg.sender, "Only current owner can transfer");
        require(lands[_landId].status == Status.Approved, "Land must be approved");
        require(_newOwner != address(0), "Invalid new owner address");
        require(_newOwner != msg.sender, "Cannot transfer to self");
        require(users[_newOwner].isActive, "New owner must be registered");
        require(!documentHashExists[_transferDocHash], "Transfer document already used");
        
        address previousOwner = lands[_landId].currentOwner;
        lands[_landId].currentOwner = _newOwner;
        documentHashExists[_transferDocHash] = true;
        
        // Add to history
        landHistory[_landId].push(OwnershipHistory({
            previousOwner: previousOwner,
            newOwner: _newOwner,
            transferDate: block.timestamp,
            ipfsDocHash: _transferDocHash
        }));
        
        emit OwnershipTransferred(_landId, previousOwner, _newOwner);
    }
    
    // View Functions
    function getLandDetails(uint256 _landId) public view landExists(_landId) returns (
        string memory surveyNumber,
        string memory location,
        uint256 area,
        address currentOwner,
        Status status,
        uint256 registrationDate,
        string memory ipfsHash
    ) {
        Land memory land = lands[_landId];
        return (
            land.surveyNumber,
            land.location,
            land.area,
            land.currentOwner,
            land.status,
            land.registrationDate,
            land.ipfsHash
        );
    }
    
    function getLandHistory(uint256 _landId) public view landExists(_landId) 
        returns (OwnershipHistory[] memory) {
        return landHistory[_landId];
    }
    
    function getUserRole(address _userAddress) public view returns (Role) {
        return users[_userAddress].role;
    }
    
    function isUserActive(address _userAddress) public view returns (bool) {
        return users[_userAddress].isActive;
    }
    
    function getTotalLands() public view returns (uint256) {
        return landCounter;
    }
}