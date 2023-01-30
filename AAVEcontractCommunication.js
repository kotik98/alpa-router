const { ethers, BigNumber } = require('ethers');
const JSBI  = require('jsbi'); // jsbi@3.2.5
const { token0Contract, token1Contract, getGasPrice, approveMax, web3Provider } = require('./uniswapContractCommunication')
const PoolABI = require('./abi/AAVEPoolABI.json')
const ERC20ABI = require('./abi/ERC20ABI.json')
const wethABI = require('./abi/WETHGatewayABI.json')
const { abi: module_abi } =  require('./abi/WhitelistingModuleV2.json')
const { UiPoolDataProvider, UiIncentiveDataProvider, ChainId } = require('@aave/contract-helpers')
const { formatReserves, formatReservesAndIncentives, formatUserSummary } = require('@aave/math-utils')

require('dotenv').config()
const { SAFE_ADDRESS, gasStationUrl, MODULE_ADDRESS, AAVEpoolAddress, uiPoolDataProviderV3, uiIncentiveDataProviderV3, lendingPoolAddressProvider } = process.env;

const iface = new ethers.utils.Interface(module_abi)
const poolIface = new ethers.utils.Interface(PoolABI)
// const pool = new ethers.Contract(AAVEpoolAddress, PoolABI, web3Provider)
// const borrowingTokenContract = token0Contract
// const suppliedTokenContract = new ethers.Contract(supplyTokenAddress, ERC20ABI, web3Provider)

const poolDataProviderContract = new UiPoolDataProvider({
    uiPoolDataProviderAddress: uiPoolDataProviderV3,
    provider: web3Provider,
});
  
const incentiveDataProviderContract = new UiIncentiveDataProvider({
    uiIncentiveDataProviderAddress: uiIncentiveDataProviderV3,
    provider: web3Provider,
});



async function getUserSummary(WALLET_ADDRESS){
    const reserves = await poolDataProviderContract.getReservesHumanized({
        lendingPoolAddressProvider,
    });
    
    const userReserves = await poolDataProviderContract.getUserReservesHumanized({
        lendingPoolAddressProvider: lendingPoolAddressProvider,
        user: WALLET_ADDRESS
    });

    // Array of incentive tokens with price feed and emission APR
    // const reserveIncentives = await incentiveDataProviderContract.getReservesIncentivesDataHumanized({
    //     lendingPoolAddressProvider,
    // });
    
    // Dictionary of claimable user incentives
    // const userIncentives = await incentiveDataProviderContract.getUserReservesIncentivesDataHumanized({
    //     lendingPoolAddressProvider,
    //     WALLET_ADDRESS,
    // });
    
    // reserves input from Fetching Protocol Data section
    
    const reservesArray = reserves.reservesData;
    const baseCurrencyData = reserves.baseCurrencyData;
    
    const currentTimestamp = Math.floor(Date.now() / 1000);
    
    /*
    - @param `reserves` Input from [Fetching Protocol Data](#fetching-protocol-data), `reserves.reservesArray`
    - @param `currentTimestamp` Current UNIX timestamp in seconds
    - @param `marketReferencePriceInUsd` Input from [Fetching Protocol Data](#fetching-protocol-data), `reserves.baseCurrencyData.marketReferencePriceInUsd`
    - @param `marketReferenceCurrencyDecimals` Input from [Fetching Protocol Data](#fetching-protocol-data), `reserves.baseCurrencyData.marketReferenceCurrencyDecimals`
    */
    const formattedReserves = formatReserves({
      reserves: reservesArray,
      currentTimestamp,
      marketReferenceCurrencyDecimals: baseCurrencyData.marketReferenceCurrencyDecimals,
      marketReferencePriceInUsd: baseCurrencyData.marketReferenceCurrencyPriceInUsd,
    });
    
    // const formatReservesAndIncent = formatReservesAndIncentives({
    //   reserves: reservesArray,
    //   currentTimestamp,
    //   marketReferenceCurrencyDecimals: baseCurrencyData.marketReferenceCurrencyDecimals,
    //   marketReferencePriceInUsd: baseCurrencyData.marketReferenceCurrencyPriceInUsd,
    //   reserveIncentives,
    // });

    const userReservesArray = userReserves.userReserves;

    return formatUserSummary({
        currentTimestamp,
        marketReferencePriceInUsd: baseCurrencyData.marketReferenceCurrencyPriceInUsd,
        marketReferenceCurrencyDecimals: baseCurrencyData.marketReferenceCurrencyDecimals,
        userReserves: userReservesArray,
        formattedReserves,
        userEmodeCategoryId: userReserves.userEmodeCategoryId,
    })
}

async function supply(assetAddress, amount, referralCode, wallet){
    const gasPrice = await getGasPrice(gasStationUrl)

    const data = poolIface.encodeFunctionData('supply', [ assetAddress, amount, SAFE_ADDRESS, referralCode ]) 
    const txData = iface.encodeFunctionData('execTransaction', [ AAVEpoolAddress, '0', data ])
    const transaction = {
        data: txData,
        to: MODULE_ADDRESS,
        value: '0',
        gasPrice: gasPrice,
        gasLimit: ethers.utils.hexlify(500000)
    }
    return await wallet.sendTransaction(transaction).then(function(transaction) {
        return transaction.wait();
    })
}

async function withdraw(assetAddress, amount, wallet){
    const gasPrice = await getGasPrice(gasStationUrl)

    const data = poolIface.encodeFunctionData('withdraw', [ assetAddress, amount, SAFE_ADDRESS ]) 
    const txData = iface.encodeFunctionData('execTransaction', [ AAVEpoolAddress, '0', data ])
    const transaction = {
        data: txData,
        to: MODULE_ADDRESS,
        value: '0',
        gasPrice: gasPrice,
        gasLimit: ethers.utils.hexlify(500000)
    }
    return await wallet.sendTransaction(transaction).then(function(transaction) {
        return transaction.wait();
    })
}

async function borrow(assetAddress, amount, interestRateMode, referralCode, wallet){
    const gasPrice = await getGasPrice(gasStationUrl)

    const data = poolIface.encodeFunctionData('borrow', [ assetAddress, amount, interestRateMode, referralCode, SAFE_ADDRESS ]) 
    const txData = iface.encodeFunctionData('execTransaction', [ AAVEpoolAddress, '0', data ])
    const transaction = {
        data: txData,
        to: MODULE_ADDRESS,
        value: '0',
        gasPrice: gasPrice,
        gasLimit: ethers.utils.hexlify(500000)
    }
    return await wallet.sendTransaction(transaction).then(function(transaction) {
        return transaction.wait();
    })
}

async function repay(assetAddress, amount, RateMode, wallet){
    const gasPrice = await getGasPrice(gasStationUrl)

    const data = poolIface.encodeFunctionData('repay', [ assetAddress, amount, RateMode, SAFE_ADDRESS ]) 
    const txData = iface.encodeFunctionData('execTransaction', [ AAVEpoolAddress, '0', data ])
    const transaction = {
        data: txData,
        to: MODULE_ADDRESS,
        value: '0',
        gasPrice: gasPrice,
        gasLimit: ethers.utils.hexlify(500000)
    }
    return await wallet.sendTransaction(transaction).then(function(transaction) {
        return transaction.wait();
    })
}

module.exports = {
    AAVEpoolAddress,
    getUserSummary,
    supply,
    withdraw,
    borrow,
    repay
}