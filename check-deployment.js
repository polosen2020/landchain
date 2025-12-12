import Web3 from 'web3';
import fs from 'fs';

const web3 = new Web3('http://127.0.0.1:8545');

async function checkDeployment() {
    console.log('🔍 Checking deployment...\n');
    
    // Read deployment info
    try {
        const deploymentInfo = JSON.parse(fs.readFileSync('deployment-info.json', 'utf8'));
        console.log('📋 Deployment Info:');
        console.log(`   Address: ${deploymentInfo.contractAddress}`);
        console.log(`   Network: ${deploymentInfo.network}`);
        console.log(`   Time: ${deploymentInfo.timestamp}\n`);
        
        // Check if contract exists
        const code = await web3.eth.getCode(deploymentInfo.contractAddress);
        if (code === '0x') {
            console.log('❌ Contract NOT deployed at this address');
            console.log('   Run: npx hardhat run scripts/deploy.js --network localhost\n');
        } else {
            console.log('✅ Contract deployed successfully\n');
            
            // Check ABI
            if (fs.existsSync('LandRegistryABI.json')) {
                console.log('✅ ABI file exists\n');
            } else {
                console.log('❌ ABI file missing\n');
            }
            
            console.log('📝 Next steps:');
            console.log('1. Copy contract address to frontend/index.html');
            console.log('2. Copy LandRegistryABI.json content to frontend CONTRACT_ABI');
            console.log('3. Refresh your browser');
        }
    } catch (error) {
        console.log('❌ deployment-info.json not found');
        console.log('   Run: npx hardhat run scripts/deploy.js --network localhost\n');
    }
}

checkDeployment();