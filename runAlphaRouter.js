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

const web3Provider = new ethers.providers.JsonRpcProvider("https://polygon-mainnet.g.alchemy.com/v2/6aCuWP8Oxcd-4jvmNYLh-WervViwIeJq")
const chainId = 137

const router = new AlphaRouter({ chainId: chainId, provider: web3Provider})

const Token0 = new Token(
  chainId,
  '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
  18,
  'WMATIC',
  'Wrapped Matic'
);

const Token1 = new Token(
  chainId,
  '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
  6,
  'USDT',
  'Tether USD'
);

const poolAddress = '0x9B08288C3Be4F62bbf8d1C20Ac9C5e6f9467d8B7'
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

    const wallet = new ethers.Wallet(WALLET_SECRET)
    const connectedWallet = wallet.connect(web3Provider)

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
            swapOptions: {
                recipient: WALLET_ADDRESS,
                slippageTolerance: new Percent(5, 100),
                deadline: 100
            },
            addLiquidityOptions: {
                recipient: WALLET_ADDRESS
            }
        }
    );
    // console.log(routeToRatioResponse)

    // const route = routeToRatioResponse.result
    // console.log(route.gasPriceWei.toBigInt())
    // console.log(BigNumber.from(route.gasPriceWei.toBigInt() * 2n))

    if (routeToRatioResponse.status === SwapToRatioStatus.SUCCESS) {
        const route = routeToRatioResponse.result

        // const approvalAmount0 = ethers.utils.parseUnits(token0Amount, Token0.decimals).toString()
        // const ERC20ABI = require('./abi.json')
        // const contract0 = new ethers.Contract(Token0.address, ERC20ABI, web3Provider)
        // await contract0.connect(connectedWallet).approve(
        //     V3_SWAP_ROUTER_ADDRESS,
        //     approvalAmount0,
        //     {
        //         gasPrice: BigNumber.from(route.gasPriceWei.toBigInt() * 2n),
        //     }
        // )
        //
        // const approvalAmount1 = ethers.utils.parseUnits(token1Amount, Token1.decimals).toString()
        // const contract1 = new ethers.Contract(Token1.address, ERC20ABI, web3Provider)
        // await contract1.connect(connectedWallet).approve(
        //     V3_SWAP_ROUTER_ADDRESS,
        //     approvalAmount1,
        //     {
        //         gasPrice: BigNumber.from(route.gasPriceWei.toBigInt() * 2n),
        //     }
        // )

        const transaction = {
            data: route.methodParameters.calldata,
            to: V3_SWAP_ROUTER_ADDRESS,
            value: BigNumber.from(route.methodParameters.value),
            from: WALLET_ADDRESS,
            gasPrice: BigNumber.from(route.gasPriceWei.toBigInt() * 10n),
            gasLimit: BigNumber.from('1000000')
        };

        // console.log(transaction)
        await connectedWallet.sendTransaction(transaction);
    }

}

swap_and_add(5, '2', '0')
