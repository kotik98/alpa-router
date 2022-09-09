const { ethers, BigNumber } = require('ethers');
const JSBI  = require('jsbi'); // jsbi@3.2.5
const { web3Provider, getGasPrice, approveMax } = require('./uniswapContractCommunication')
const PoolABI = require('./AAVEPoolABI.json')

AAVEpoolAddress = '0x794a61358D6845594F94dc1DB02A252b5b4814aD'
const AAVEpoolContract = ethers.Contract(AAVEpoolAddress, PoolABI, web3Provider)

async function supply(assetAddress, amount, referralCode, WALLET_ADDRESS, WALLET_SECRET){
    const url = 'https://gasstation-mainnet.matic.network/v2';
    const gasPrice = getGasPrice(url)

    const wallet = new ethers.Wallet(WALLET_SECRET)
    const connectedWallet = wallet.connect(web3Provider)

    const callParameters = {
        asset: assetAddress,
        amount: amount,
        onBehalfOf: WALLET_ADDRESS,
        referralCode: referralCode
    }

    const transaction = {
        data: callParameters,
        to: AAVEpoolAddress,
        from: WALLET_ADDRESS,
        gasPrice: gasPrice,
        gasLimit: BigNumber.from('1000000')
    };

}

async function withdraw(assetAddress, amount, WALLET_ADDRESS, WALLET_SECRET){

}

async function borrow(assetAddress, amount, interestRateMode, referralCode, WALLET_ADDRESS, WALLET_SECRET){

}

async function repay(assetAddress, amount, RateMode, WALLET_ADDRESS, WALLET_SECRET){

}

module.exports = {
    AAVEpoolContract,
    supply,
    withdraw,
    borrow,
    repay
}