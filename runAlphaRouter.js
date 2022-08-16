const {Fraction} = require("@uniswap/sdk");
const {Position} = require("@uniswap/v3-sdk");
const { AlphaRouter } = require('@uniswap/smart-order-router');
const { Token, CurrencyAmount, Percent } = require('@uniswap/sdk-core');
const { ethers, BigNumber } = require('ethers');
const { Pool } = require('@uniswap/v3-sdk');
const { abi } = require('@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Pool.sol/IUniswapV3Pool.json');
const JSBI  = require('jsbi'); // jsbi@3.2.5
const { SwapToRatioStatus } = require("@uniswap/smart-order-router");

const V3_SWAP_ROUTER_ADDRESS = "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45";

require('dotenv').config()
const WALLET_ADDRESS = process.env.WALLET_ADDRESS
const WALLET_SECRET = process.env.WALLET_SECRET
//const INFURA_TEST_URL = process.env.INFURA_TEST_URL

const web3Provider = new ethers.providers.JsonRpcProvider("HTTP://127.0.0.1:7545")
const chainId = 1

const router = new AlphaRouter({ chainId: chainId, provider: web3Provider})

const Token0 = new Token(
  chainId,
  '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  18,
  'WETH',
  'Wrapped Ether'
);

const Token1 = new Token(
  chainId,
  '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  6,
  'USDT',
  'Tether USD'
);

const poolAddress = '0x4e68Ccd3E89f51C3074ca5072bbAC773960dFa36'
const poolContract = new ethers.Contract(poolAddress, abi, web3Provider)

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

async function swap_and_add(width, token0Amount, token1Amount) {
    const token0Balance = CurrencyAmount.fromRawAmount(Token0, JSBI.BigInt(ethers.utils.parseUnits(token0Amount, Token0.decimals)))
    const token1Balance = CurrencyAmount.fromRawAmount(Token1, JSBI.BigInt(ethers.utils.parseUnits(token1Amount, Token1.decimals)))

    const [immutables, state] = await Promise.all([getPoolImmutables(), getPoolState()])
    // console.log(immutables)
    // console.log(state)

    const poolExample = new Pool(
        Token0,
        Token1,
        immutables.fee,
        sqrtRatioX96 = state.sqrtPriceX96.toString(),
        state.liquidity.toString(),
        state.tick,
    )
    // console.log(poolExample)

    const position = new Position({
        pool: poolExample,
        tickLower: state.tick - width * immutables.tickSpacing - ((state.tick - width * immutables.tickSpacing) % immutables.tickSpacing),
        tickUpper: state.tick + width * immutables.tickSpacing + (immutables.tickSpacing - (state.tick + width * immutables.tickSpacing) % immutables.tickSpacing),
        liquidity: 1,
    })
    // console.log(position)

    const routeToRatioResponse = await router.routeToRatio(
        token0Balance,
        token1Balance,
        position,
        {
            ratioErrorTolerance: new Fraction(1, 100),
            maxIterations: 6,
        },
        {
            swapConfig: {
                recipient: WALLET_ADDRESS,
                slippage: new Percent(5, 100),
                deadline: 100
            },
            addLiquidityOptions: {
                recipient: WALLET_ADDRESS
            }
        }
    );
    console.log('routeToRatioResponse.status')
    console.log(routeToRatioResponse.status)

    if (routeToRatioResponse.status == SwapToRatioStatus.success) {
        const route = routeToRatioResponse.result
        const transaction = {
            data: route.methodParameters.calldata,
            to: V3_SWAP_ROUTER_ADDRESS,
            value: BigNumber.from(route.methodParameters.value),
            from: WALLET_ADDRESS,
            gasPrice: BigNumber.from(route.gasPriceWei),
        };
    }

    const wallet = new ethers.Wallet(WALLET_SECRET)
    const connectedWallet = wallet.connect(web3Provider)

    const approvalAmount0 = ethers.utils.parseUnits(token0Amount, Token0.decimals).toString()
    const ERC20ABI = require('./abi.json')
    const contract0 = new ethers.Contract(Token0.address, ERC20ABI, web3Provider)
    await contract0.connect(connectedWallet).approve(
        V3_SWAP_ROUTER_ADDRESS,
        approvalAmount0
    )

    const approvalAmount1 = ethers.utils.parseUnits(token1Amount, Token1.decimals).toString()
    const contract1 = new ethers.Contract(Token1.address, ERC20ABI, web3Provider)
    await contract1.connect(connectedWallet).approve(
        V3_SWAP_ROUTER_ADDRESS,
        approvalAmount1
    )

    await connectedWallet.sendTransaction(transaction);
}

swap_and_add(5, '1', '1600')
