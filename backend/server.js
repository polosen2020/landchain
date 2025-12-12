// server.js
// server.js
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import crypto from 'crypto';
import { create } from 'ipfs-http-client';
import Web3 from 'web3';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// File upload configuration
const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// IPFS Configuration
const ipfs = create({
  host: "127.0.0.1",  // Force IPv4
  port: process.env.IPFS_PORT,
  protocol: process.env.IPFS_PROTOCOL
});


// Web3 Configuration
const web3 = new Web3(process.env.BLOCKCHAIN_URL || 'http://127.0.0.1:8545');
const contractAddress = process.env.CONTRACT_ADDRESS;
const contractABI = JSON.parse(fs.readFileSync('./LandRegistryABI.json', 'utf8'));
const contract = new web3.eth.Contract(contractABI, contractAddress);

// Encryption utilities
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32);
const IV_LENGTH = 16;

function encryptFile(buffer) {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
    const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
    return Buffer.concat([iv, encrypted]);
}

function decryptFile(buffer) {
    const iv = buffer.slice(0, IV_LENGTH);
    const encrypted = buffer.slice(IV_LENGTH);
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted;
}

// Audit logging
function logAudit(action, userAddress, details) {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${action} - User: ${userAddress} - ${JSON.stringify(details)}\n`;
    fs.appendFileSync('audit.log', logEntry);
    console.log(logEntry);
}

// ============= User Management APIs =============

app.post('/api/users/register', async (req, res) => {
    try {
        const { userAddress, name, role, adminAddress, adminPrivateKey } = req.body;
        
        // Validation
        if (!web3.utils.isAddress(userAddress)) {
            return res.status(400).json({ error: 'Invalid user address' });
        }
        if (!name || name.length < 2) {
            return res.status(400).json({ error: 'Name must be at least 2 characters' });
        }
        if (![0, 1, 2].includes(parseInt(role))) {
            return res.status(400).json({ error: 'Invalid role' });
        }
        
        // Check if user already exists
        const existingUser = await contract.methods.users(userAddress).call();
        if (existingUser.isActive) {
            return res.status(400).json({ error: 'User already registered' });
        }
        
        // Execute transaction
        const account = web3.eth.accounts.privateKeyToAccount(adminPrivateKey);
        const gasEstimate = await contract.methods
            .registerUser(userAddress, name, role)
            .estimateGas({ from: adminAddress });
        
        const tx = {
            from: adminAddress,
            to: contractAddress,
            gas: gasEstimate,
            data: contract.methods.registerUser(userAddress, name, role).encodeABI()
        };
        
        const signedTx = await account.signTransaction(tx);
        const receipt = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);
        
        logAudit('USER_REGISTERED', adminAddress, { userAddress, name, role });
        
        res.json({
            success: true,
            transactionHash: receipt.transactionHash,
            userAddress: userAddress
        });
    } catch (error) {
        console.error('Error registering user:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/users/:address', async (req, res) => {
    try {
        const { address } = req.params;
        
        if (!web3.utils.isAddress(address)) {
            return res.status(400).json({ error: 'Invalid address' });
        }
        
        const user = await contract.methods.users(address).call();
        
        res.json({
            address: user.userAddress,
            role: parseInt(user.role),
            name: user.name,
            isActive: user.isActive
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============= Land Registration APIs =============

app.post('/api/lands/register', upload.single('document'), async (req, res) => {
    try {
        const { surveyNumber, location, area, ownerAddress, ownerPrivateKey } = req.body;
        const document = req.file;
        
        // Validation
        if (!surveyNumber || !location || !area || !document) {
            return res.status(400).json({ error: 'All fields are required' });
        }
        if (!web3.utils.isAddress(ownerAddress)) {
            return res.status(400).json({ error: 'Invalid owner address' });
        }
        if (parseFloat(area) <= 0) {
            return res.status(400).json({ error: 'Area must be greater than 0' });
        }
        
        // Check for duplicate survey number
        const isDuplicate = await contract.methods.surveyNumberExists(surveyNumber).call();
        if (isDuplicate) {
            return res.status(400).json({ error: 'Survey number already exists' });
        }
        
        // Encrypt document
        const encryptedBuffer = encryptFile(document.buffer);
        
        // Upload to IPFS
        const ipfsResult = await ipfs.add(encryptedBuffer);
        const ipfsHash = ipfsResult.path;
        
        // Register on blockchain
        const account = web3.eth.accounts.privateKeyToAccount(ownerPrivateKey);
        const gasEstimate = await contract.methods
            .registerLand(surveyNumber, location, area, ipfsHash)
            .estimateGas({ from: ownerAddress });
        
        const tx = {
            from: ownerAddress,
            to: contractAddress,
            gas: gasEstimate,
            data: contract.methods.registerLand(surveyNumber, location, area, ipfsHash).encodeABI()
        };
        
        const signedTx = await account.signTransaction(tx);
        const receipt = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);
        
        // Get land ID from event logs
        const landId = parseInt(receipt.logs[0].topics[1], 16);
        
        logAudit('LAND_REGISTERED', ownerAddress, { landId, surveyNumber, ipfsHash });
        
        res.json({
            success: true,
            landId: landId,
            transactionHash: receipt.transactionHash,
            ipfsHash: ipfsHash
        });
    } catch (error) {
        console.error('Error registering land:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/lands/:landId', async (req, res) => {
    try {
        const { landId } = req.params;
        
        const land = await contract.methods.lands(landId).call();
        
        if (!land.exists) {
            return res.status(404).json({ error: 'Land not found' });
        }
        
        res.json({
            landId: parseInt(land.landId),
            surveyNumber: land.surveyNumber,
            location: land.location,
            area: parseInt(land.area),
            currentOwner: land.currentOwner,
            status: parseInt(land.status),
            registrationDate: parseInt(land.registrationDate),
            ipfsHash: land.ipfsHash
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/lands/:landId/document', async (req, res) => {
    try {
        const { landId } = req.params;
        const { userAddress } = req.query;
        
        // Get land details
        const land = await contract.methods.lands(landId).call();
        
        if (!land.exists) {
            return res.status(404).json({ error: 'Land not found' });
        }
        
        // Check authorization
        const user = await contract.methods.users(userAddress).call();
        if (!user.isActive) {
            return res.status(403).json({ error: 'Unauthorized access' });
        }
        
        const isOwner = land.currentOwner.toLowerCase() === userAddress.toLowerCase();
        const isVerifierOrAdmin = [1, 2].includes(parseInt(user.role));
        
        if (!isOwner && !isVerifierOrAdmin) {
            return res.status(403).json({ error: 'Not authorized to view document' });
        }
        
        // Fetch from IPFS
        const chunks = [];
        for await (const chunk of ipfs.cat(land.ipfsHash)) {
            chunks.push(chunk);
        }
        const encryptedBuffer = Buffer.concat(chunks);
        
        // Decrypt
        const decryptedBuffer = decryptFile(encryptedBuffer);
        
        res.set('Content-Type', 'application/pdf');
        res.send(decryptedBuffer);
    } catch (error) {
        console.error('Error fetching document:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/lands/:landId/history', async (req, res) => {
    try {
        const { landId } = req.params;
        
        const history = await contract.methods.getLandHistory(landId).call();
        
        const formattedHistory = history.map(entry => ({
            previousOwner: entry.previousOwner,
            newOwner: entry.newOwner,
            transferDate: parseInt(entry.transferDate),
            ipfsDocHash: entry.ipfsDocHash
        }));
        
        res.json(formattedHistory);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============= Verification APIs =============

app.post('/api/lands/:landId/verify', async (req, res) => {
    try {
        const { landId } = req.params;
        const { status, verifierAddress, verifierPrivateKey } = req.body;
        
        // Validation
        if (![1, 2].includes(parseInt(status))) {
            return res.status(400).json({ error: 'Status must be Approved (1) or Rejected (2)' });
        }
        
        const account = web3.eth.accounts.privateKeyToAccount(verifierPrivateKey);
        const gasEstimate = await contract.methods
            .verifyLand(landId, status)
            .estimateGas({ from: verifierAddress });
        
        const tx = {
            from: verifierAddress,
            to: contractAddress,
            gas: gasEstimate,
            data: contract.methods.verifyLand(landId, status).encodeABI()
        };
        
        const signedTx = await account.signTransaction(tx);
        const receipt = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);
        
        logAudit('LAND_VERIFIED', verifierAddress, { landId, status });
        
        res.json({
            success: true,
            transactionHash: receipt.transactionHash
        });
    } catch (error) {
        console.error('Error verifying land:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/lands/pending', async (req, res) => {
    try {
        const totalLands = await contract.methods.getTotalLands().call();
        const pendingLands = [];
        
        for (let i = 1; i <= totalLands; i++) {
            const land = await contract.methods.lands(i).call();
            if (parseInt(land.status) === 0) { // Pending
                pendingLands.push({
                    landId: parseInt(land.landId),
                    surveyNumber: land.surveyNumber,
                    location: land.location,
                    area: parseInt(land.area),
                    currentOwner: land.currentOwner,
                    registrationDate: parseInt(land.registrationDate)
                });
            }
        }
        
        res.json(pendingLands);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============= Transfer APIs =============

app.post('/api/lands/:landId/transfer', upload.single('transferDocument'), async (req, res) => {
    try {
        const { landId } = req.params;
        const { newOwnerAddress, currentOwnerAddress, currentOwnerPrivateKey } = req.body;
        const document = req.file;
        
        if (!document) {
            return res.status(400).json({ error: 'Transfer document required' });
        }
        if (!web3.utils.isAddress(newOwnerAddress)) {
            return res.status(400).json({ error: 'Invalid new owner address' });
        }
        
        // Encrypt and upload document
        const encryptedBuffer = encryptFile(document.buffer);
        const ipfsResult = await ipfs.add(encryptedBuffer);
        const transferDocHash = ipfsResult.path;
        
        // Transfer ownership
        const account = web3.eth.accounts.privateKeyToAccount(currentOwnerPrivateKey);
        const gasEstimate = await contract.methods
            .transferOwnership(landId, newOwnerAddress, transferDocHash)
            .estimateGas({ from: currentOwnerAddress });
        
        const tx = {
            from: currentOwnerAddress,
            to: contractAddress,
            gas: gasEstimate,
            data: contract.methods.transferOwnership(landId, newOwnerAddress, transferDocHash).encodeABI()
        };
        
        const signedTx = await account.signTransaction(tx);
        const receipt = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);
        
        logAudit('OWNERSHIP_TRANSFERRED', currentOwnerAddress, { 
            landId, 
            newOwner: newOwnerAddress,
            transferDocHash 
        });
        
        res.json({
            success: true,
            transactionHash: receipt.transactionHash
        });
    } catch (error) {
        console.error('Error transferring ownership:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============= Statistics APIs =============

app.get('/api/statistics', async (req, res) => {
    try {
        const totalLands = await contract.methods.getTotalLands().call();
        let pending = 0, approved = 0, rejected = 0;
        
        for (let i = 1; i <= totalLands; i++) {
            const land = await contract.methods.lands(i).call();
            const status = parseInt(land.status);
            if (status === 0) pending++;
            else if (status === 1) approved++;
            else if (status === 2) rejected++;
        }
        
        res.json({
            totalLands: parseInt(totalLands),
            pending,
            approved,
            rejected
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
    console.log(`LandChain Backend running on port ${PORT}`);
    console.log(`Contract Address: ${contractAddress}`);
});