const { NonfungiblePositionManager } = require("@uniswap/v3-sdk");
const { Fraction } = require("@uniswap/sdk");
const { Position } = require("@uniswap/v3-sdk");
const { AlphaRouter } = require('@uniswap/smart-order-router');
const { Token, CurrencyAmount, Percent, TradeType } = require('@uniswap/sdk-core');
const { ethers, BigNumber } = require('ethers');
const { Pool } = require('@uniswap/v3-sdk');
const NftPosManagerABI = require('./abi/V3PosManagerABI.json')
const { abi } = require('@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Pool.sol/IUniswapV3Pool.json');
const JSBI  = require('jsbi'); // jsbi@3.2.5
const { SwapToRatioStatus } = require("@uniswap/smart-order-router");
const fetch = require("node-fetch"); // node-fetch@1.7.3
const { module_abi } =  require('./abi/WhitelistingModuleV2.json')

require('dotenv').config()
const { V3_SWAP_ROUTER_ADDRESS, V3_NFT_POS_MANAGER_ADDRESS, SAFE_ADDRESS, WMATIC_ADDRESS, USDT_ADDRESS, USDC_ADDRESS, POOL_ADDRESS, ALCHEMY_API, gasStationUrl, MODULE_ADDRESS } = process.env;

// polygon
const chainId = 137
const web3Provider = new ethers.providers.StaticJsonRpcProvider(ALCHEMY_API, chainId)
const Token0 = new Token(
  chainId,
  WMATIC_ADDRESS,
  18,
  'WMATIC',
  'Wrapped Matic'
);
const Token1 = new Token(
    chainId,
    USDT_ADDRESS,
    6,
    'USDT',
    'Tether USD'
);
const tokenForAAVE = new Token(
    chainId,
    USDC_ADDRESS,
    6,
    'USDC',
    'USD Coin'
);

const ERC20ABI = require('./abi/ERC20ABI.json')
const iface = new ethers.utils.Interface(module_abi.abi)
const token0Contract = new ethers.Contract(Token0.address, ERC20ABI, web3Provider)
const token1Contract = new ethers.Contract(Token1.address, ERC20ABI, web3Provider)
const tokenForAAVEContract = new ethers.Contract(tokenForAAVE.address, ERC20ABI, web3Provider)

const router = new AlphaRouter({ chainId: chainId, provider: web3Provider})

const poolContract = new ethers.Contract(POOL_ADDRESS, abi, web3Provider)

async function getPoolImmutables() {
    const [factory, token0, token1, fee, tickSpacing, maxLiquidityPerTick] = await Promise.all([
        poolContract.factory(),
        poolContract.token0(),
        poolContract.token1(),
        poolContract.fee(),
        poolContract.tickSpacing(),
        poolContract.maxLiquidityPerTick(),
    ])

    return {
        factory,
        token0,
        token1,
        fee,
        tickSpacing,
        maxLiquidityPerTick,
    }
}

async function getPoolState() {
    const liquidity = await poolContract.liquidity();
    const slot = await poolContract.slot0();

    return {
        liquidity,
        sqrtPriceX96: slot[0],
        tick: slot[1],
        observationIndex: slot[2],
        observationCardinality: slot[3],
        observationCardinalityNext: slot[4],
        feeProtocol: slot[5],
        unlocked: slot[6],
    };
}

async function swapAndAdd(width, token0Amount, token1Amount, wallet) {

    token0Amount = Number(token0Amount).toFixed(Token0.decimals)
    token1Amount = Number(token1Amount).toFixed(Token1.decimals)
    const token0Balance = CurrencyAmount.fromRawAmount(Token0, JSBI.BigInt(ethers.utils.parseUnits(String(token0Amount), Token0.decimals)))
    const token1Balance = CurrencyAmount.fromRawAmount(Token1, JSBI.BigInt(ethers.utils.parseUnits(String(token1Amount), Token1.decimals)))

    const [immutables, state] = await Promise.all([getPoolImmutables(), getPoolState()])

    const poolExample = new Pool(
        Token0,
        Token1,
        immutables.fee,
        state.sqrtPriceX96.toString(),
        state.liquidity.toString(),
        state.tick,
    )

    const position = new Position({
        pool: poolExample,
        tickLower: state.tick - width * immutables.tickSpacing - ((state.tick - width * immutables.tickSpacing) % immutables.tickSpacing),
        tickUpper: state.tick + width * immutables.tickSpacing + (immutables.tickSpacing - (state.tick + width * immutables.tickSpacing) % immutables.tickSpacing),
        liquidity: 1,
    })

    const routeToRatioResponse = await router.routeToRatio(
        token0Balance,
        token1Balance,
        position,
        {
            ratioErrorTolerance: new Fraction(5, 100),
            // maxIterations: 10,
        },
        {
            swapOptions: {
                recipient: SAFE_ADDRESS,
                slippageTolerance: new Percent(4, 100),
                deadline: Math.round(Date.now() / 1000) + 300,
            },
            addLiquidityOptions: {
                recipient: SAFE_ADDRESS
            }
        }
    );

    const gasPrice = await getGasPrice(gasStationUrl);

    if (routeToRatioResponse.status === SwapToRatioStatus.SUCCESS) {
        const route = routeToRatioResponse.result

        const data = iface.encodeFunctionData('execTransaction', [ V3_SWAP_ROUTER_ADDRESS, BigNumber.from(route.methodParameters.value), route.methodParameters.calldata])

        const transaction = {
            data: data,
            to: MODULE_ADDRESS,
            value: BigNumber.from(route.methodParameters.value),
            gasPrice: gasPrice,
            gasLimit: ethers.utils.hexlify(1000000)
        }
        return await wallet.sendTransaction(transaction).then(function(transaction) {
            return transaction.wait();
        })
    }

}

async function getGasPrice(url){
    return await fetch(url)
        .then(response => response.json())
        .then(json => (BigNumber.from(Math.round(json.standard.maxFee * (10 ** 9)))))
}

async function removeAndBurn(wallet){

    const NftPosManagerContract = new ethers.Contract(V3_NFT_POS_MANAGER_ADDRESS, NftPosManagerABI, web3Provider)

    if (Number(NftPosManagerContract.balanceOf(SAFE_ADDRESS)) > 0){

        const tokenId = await NftPosManagerContract.tokenOfOwnerByIndex(wallet.address, 0)
        const positiondata = await NftPosManagerContract.positions(tokenId)
        
        const [immutables, state] = await Promise.all([getPoolImmutables(), getPoolState()])

        const pool = new Pool(
            Token0,
            Token1,
            immutables.fee,
            state.sqrtPriceX96.toString(),
            state.liquidity.toString(),
            state.tick,
        )

        const position = new Position({
            pool: pool,
            tickLower: positiondata.tickLower,
            tickUpper: positiondata.tickUpper,
            liquidity: JSBI.BigInt(positiondata.liquidity),
        })


        const { calldata, value } = NonfungiblePositionManager.removeCallParameters(position, {
            tokenId: tokenId,
            liquidityPercentage: new Percent(1),
            slippageTolerance: new Percent(10, 100),
            deadline: Math.round(Date.now() / 1000) + 300,
            burnToken: true,
            collectOptions: {
                expectedCurrencyOwed0: CurrencyAmount.fromRawAmount(Token0, 0),
                expectedCurrencyOwed1: CurrencyAmount.fromRawAmount(Token1, 0),
                recipient: SAFE_ADDRESS,
            },
        })


        let gasPrice = await getGasPrice(gasStationUrl);
        const nftPosManagerIface = new ethers.utils.Interface(NftPosManagerABI)
        let data = nftPosManagerIface.encodeFunctionData('approve', [ V3_NFT_POS_MANAGER_ADDRESS, tokenId ]) 
        let txData = iface.encodeFunctionData('execTransaction', [ V3_NFT_POS_MANAGER_ADDRESS, '0', data ])
        let transaction = {
            data: txData,
            to: MODULE_ADDRESS,
            value: '0',
            gasPrice: gasPrice,
            gasLimit: BigNumber.from('100000')
        }
        await wallet.sendTransaction(transaction).then(function(transaction) {
            return transaction.wait();
        })

        gasPrice = await getGasPrice(gasStationUrl);
        data = iface.encodeFunctionData('execTransaction', [ V3_NFT_POS_MANAGER_ADDRESS, BigNumber.from(value), calldata])
        transaction = {
            data: data,
            to: MODULE_ADDRESS,
            value: BigNumber.from(value),
            gasPrice: gasPrice,
            gasLimit: BigNumber.from('500000')
        };
        return await wallet.sendTransaction(transaction).then(function(transaction) {
            return transaction.wait();
        })
    }
}

async function getBalance(tokenContract, wallet){
    return await tokenContract.balanceOf(wallet.address)
}

async function approveMax(tokenContract, to, WALLET_SECRET) {
    const wallet = new ethers.Wallet(WALLET_SECRET)
    const connectedWallet = wallet.connect(web3Provider)

    const gasPrice = await getGasPrice(gasStationUrl);

    return await tokenContract.connect(connectedWallet).approve(
        to,
        ethers.constants.MaxUint256,
        {
            gasPrice: gasPrice,
            gasLimit: BigNumber.from('100000')
        }
    ).then(function(transaction) {
        return transaction.wait();
    })
}

async function swap(inputToken, outputToken, amount, wallet) {
    amount = Number(amount).toFixed(inputToken.decimals)
    const inputTokenBalance = CurrencyAmount.fromRawAmount(inputToken, JSBI.BigInt(ethers.utils.parseUnits(String(amount), inputToken.decimals)))
    const route = await router.route(
        inputTokenBalance,
        outputToken,
        TradeType.EXACT_INPUT,
        {
            recipient: SAFE_ADDRESS,
            slippageTolerance: new Percent(5, 100),
            deadline: Math.floor(Date.now()/1000 + 240)
        }
    )

    const data = iface.encodeFunctionData('execTransaction', [ V3_SWAP_ROUTER_ADDRESS, BigNumber.from(route.methodParameters.value), route.methodParameters.calldata])

    const transaction = {
        data: data,
        to: MODULE_ADDRESS,
        value: BigNumber.from(route.methodParameters.value),
        gasPrice: BigNumber.from(route.gasPriceWei),
        gasLimit: ethers.utils.hexlify(1000000)
    }
    return await wallet.sendTransaction(transaction).then(function(transaction) {
        return transaction.wait();
    })
}

module.exports = {
    V3_SWAP_ROUTER_ADDRESS,
    Token0,
    Token1,
    tokenForAAVE,
    token0Contract,
    token1Contract,
    tokenForAAVEContract,
    web3Provider,
    chainId,
    gasStationUrl,
    getPoolImmutables,
    getPoolState,
    swapAndAdd,
    swap,
    getGasPrice,
    removeAndBurn,
    getBalance,
    approveMax
}

