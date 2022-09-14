const { V3_SWAP_ROUTER_ADDRESS, Token0, Token1, tokenForAAVE, token0Contract, token1Contract, tokenForAAVEContract, getPoolState, getBalance, getGasPrice, getPoolImmutables, swapAndAdd, removeAndBurn, approveMax, swap } = require('./uniswapContractCommunication');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const doc = new GoogleSpreadsheet('1xdwWPbW0LhJby-3bQ7SVMnzlS1D5k0yeH4mpEPIq2Qs');
const creds = require("./credentials.json")
const { ethers, BigNumber } = require('ethers');

var fs = require('fs');
var util = require('util');
var logFile = fs.createWriteStream('log.txt', { flags: 'a' });
  // Or 'w' to truncate the file every time the process starts.
var logStdout = process.stdout;
console.log = function () {
  logFile.write(util.format.apply(null, arguments) + '\n');
  logStdout.write(util.format.apply(null, arguments) + '\n');
}
console.error = console.log;

var args = process.argv.slice(2);

const timer = ms => new Promise(res => setTimeout(res, ms)) 

function priceToTick(price) {
    val_to_log = price * 10 ** (Token1.decimals - Token0.decimals)
    tick_id = Math.log(val_to_log) / Math.log(1.0001)
    return Math.round(tick_id, 0)
}

async function runNoHedge(args) {  // args: [ width_in_percentage, WALLET_ADDRESS, WALLET_SECRET ]

    const WALLET_ADDRESS = args[1]
    const WALLET_SECRET = args[2]

    // раскомментить при первом вызове
    // await approveMax(token0Contract, V3_SWAP_ROUTER_ADDRESS, WALLET_SECRET)
    // await approveMax(token1Contract, V3_SWAP_ROUTER_ADDRESS, WALLET_SECRET)

    let token0Balance = await getBalance(token0Contract, WALLET_ADDRESS)
    let token1Balance = await getBalance(token1Contract, WALLET_ADDRESS)
    let poolState = await getPoolState()
    let poolImmutables = await getPoolImmutables()
    let currPrice = poolState.sqrtPriceX96 * poolState.sqrtPriceX96 * (10 ** Token0.decimals) / (10 ** Token1.decimals) / 2 ** 192
    let lowerTick = priceToTick(currPrice * ((100 - Number(args[0])) / 100))
    let upperTick = priceToTick(currPrice * ((100 + Number(args[0])) / 100))
    let lowerPrice = currPrice * ((100 - Number(args[0])) / 100)
    let upperPrice = currPrice * ((100 + Number(args[0])) / 100)
    let width = Math.abs(Math.round((lowerTick - upperTick) / 2, 0)) / poolImmutables.tickSpacing
    console.log(lowerPrice, upperPrice, Date.now(), Number(token0Balance) / (10 ** Token0.decimals), Number(token1Balance) / (10 ** Token1.decimals), currPrice)

    await doc.useServiceAccountAuth(creds); 
    const sheet = await doc.addSheet({ headerValues: ['lowerBound', 'upperBound', 'UnixTime', 'token0Balance', 'token1Balance', 'currentPrice'] });

    await sheet.addRow({ lowerBound: lowerPrice, upperBound: upperPrice , UnixTime: Date.now(), 
    token0Balance: Number(token0Balance) / (10 ** Token0.decimals), token1Balance: Number(token1Balance) /(10 ** Token1.decimals), currentPrice: currPrice });

    let doLoop = true; 
    do { 
        try {
            await swapAndAdd(width, (token0Balance / 10 ** Token0.decimals).toString(), (token1Balance / 10 ** Token1.decimals).toString(), WALLET_ADDRESS, WALLET_SECRET)
            await timer(15000)
            doLoop = false; 
        } catch (err) {
            console.log(err)
            await timer(120000)
        }
    } while (doLoop)

    while (true){
        poolState = await getPoolState()
        currPrice = poolState.sqrtPriceX96 * poolState.sqrtPriceX96 * (10 ** Token0.decimals) / (10 ** Token1.decimals) / 2 ** 192

        if (upperTick < priceToTick(currPrice) || priceToTick(currPrice) < lowerTick) {
          doLoop = true; 
          do { 
              try {
                  await removeAndBurn(WALLET_ADDRESS, WALLET_SECRET)
                  doLoop = false; 
              } catch (err) {
                  console.log(err)
                  await timer(120000)
              }
          } while (doLoop)

          token0Balance = await getBalance(token0Contract, WALLET_ADDRESS)
          token1Balance = await getBalance(token1Contract, WALLET_ADDRESS)
          lowerTick = priceToTick(currPrice * ((100 - Number(args[0])) / 100))
          upperTick = priceToTick(currPrice * ((100 + Number(args[0])) / 100))
          lowerPrice = currPrice * ((100 - Number(args[0])) / 100)
          upperPrice = currPrice * ((100 + Number(args[0])) / 100)
          width = Math.abs(Math.round((lowerTick - upperTick) / 2, 0)) / poolImmutables.tickSpacing
          console.log(lowerPrice, upperPrice, Date.now(), Number(token0Balance) / (10 ** Token0.decimals), Number(token1Balance) /(10 ** Token1.decimals), currPrice)

          await sheet.addRow({ lowerBound: lowerPrice, upperBound: upperPrice , UnixTime: Date.now(), 
          token0Balance: Number(token0Balance) / (10 ** Token0.decimals), token1Balance: Number(token1Balance) /(10 ** Token1.decimals), currentPrice: currPrice });
          
          doLoop = true; 
          do { 
              try {
                  await swapAndAdd(width, (token0Balance / 10 ** Token0.decimals).toString(), (token1Balance / 10 ** Token1.decimals).toString(), WALLET_ADDRESS, WALLET_SECRET)
                  doLoop = false; 
              } catch (err) {
                  console.log(err)
                  await timer(120000)
              }
          } while (doLoop)
        }
        await timer(15000)
    }
}


const { AAVEpoolAddress, getUserSummary, supply, withdraw, borrow, repay } = require('./AAVEcontractCommunication')

async function run(args){

    const width = Number(args[0])
    const rebalancingDelta = Number(args[1])
    const healthFactor = Number(args[2])
    const WALLET_ADDRESS = args[3]
    const WALLET_SECRET = args[4]

    // approves for uniswap communication
    await approveMax(token0Contract, V3_SWAP_ROUTER_ADDRESS, WALLET_SECRET)
    await approveMax(token1Contract, V3_SWAP_ROUTER_ADDRESS, WALLET_SECRET)
    await approveMax(tokenForAAVEContract, V3_SWAP_ROUTER_ADDRESS, WALLET_SECRET)

    // approve for supply on aave
    await approveMax(tokenForAAVEContract, AAVEpoolAddress, WALLET_SECRET)

    // approve for repay on aave
    await approveMax(token0Contract, AAVEpoolAddress, WALLET_SECRET)

    let epsilon = 1    // allowable missmatch in USD
    let errTimeout = 120000     // timeout to wait after failed transaction
    let liquidationTreshold = 0.85    // liq treshold for collateral
    let targetHealthFactor = healthFactor / liquidationTreshold
    let userSummary
    let poolState = await getPoolState()
    let poolImmutables = await getPoolImmutables()
    let currPrice = poolState.sqrtPriceX96 * poolState.sqrtPriceX96 * (10 ** Token0.decimals) / (10 ** Token1.decimals) / 2 ** 192
    let token0Balance = Number(await getBalance(token0Contract, WALLET_ADDRESS)) / 10 ** Token0.decimals   // non stable asset
    let token1Balance = Number(await getBalance(token1Contract, WALLET_ADDRESS)) / 10 ** Token1.decimals
    let tokenForAAVEBalance = Number(await getBalance(tokenForAAVEContract, WALLET_ADDRESS)) / 10 ** tokenForAAVE.decimals
    let delta = (targetHealthFactor * (token0Balance * currPrice + token1Balance) - tokenForAAVEBalance) / (1 + targetHealthFactor)
    delta = delta.toFixed(6)

    let doLoop = true
    if (Math.abs(delta) > epsilon) {
        do { 
            try {
                if (delta > 0) {
                    if (delta > token0Balance * currPrice && delta > token1Balance) {
                        await Promise.all([swap(Token0, tokenForAAVE, token0Balance.toFixed(6).toString(), WALLET_ADDRESS, WALLET_SECRET),
                            swap(Token1, tokenForAAVE, (delta - token0Balance * currPrice).toFixed(6).toString(), WALLET_ADDRESS, WALLET_SECRET)])
                        
                    } else if (delta > token0Balance * currPrice && delta < token1Balance) {
                        await swap(Token1, tokenForAAVE, delta.toString(), WALLET_ADDRESS, WALLET_SECRET)
                    } else {
                        await swap(Token0, tokenForAAVE, delta.toString(), WALLET_ADDRESS, WALLET_SECRET)
                    }
                } else {
                    await swap(tokenForAAVE, Token1, Math.abs(delta).toString(), WALLET_ADDRESS, WALLET_SECRET)
                }
                doLoop = false; 
            } catch (err) {
                console.log(err)
                await timer(errTimeout)
            }
        } while (doLoop)
    }

    tokenForAAVEBalance = Number(await getBalance(tokenForAAVEContract, WALLET_ADDRESS)) / 10 ** tokenForAAVE.decimals
    doLoop = true
    do { 
        try {
            await supply(tokenForAAVE.address,  ethers.utils.parseUnits(tokenForAAVEBalance.toString(), tokenForAAVE.decimals), 0, WALLET_ADDRESS, WALLET_SECRET)
            doLoop = false; 
        } catch (err) {
            console.log(err)
            await timer(errTimeout)
        }
    } while (doLoop)

    poolState = await getPoolState()
    currPrice = poolState.sqrtPriceX96 * poolState.sqrtPriceX96 * (10 ** Token0.decimals) / (10 ** Token1.decimals) / 2 ** 192
    doLoop = true
    do { 
        try {
            await borrow(Token0.address, ethers.utils.parseUnits((tokenForAAVEBalance / targetHealthFactor / currPrice).toFixed(6).toString(), Token0.decimals), 2, 0, WALLET_ADDRESS, WALLET_SECRET)
            doLoop = false; 
        } catch (err) {
            console.log(err)
            await timer(errTimeout)
        }
    } while (doLoop)

    token0Balance = Number(await getBalance(token0Contract, WALLET_ADDRESS)) / 10 ** Token0.decimals   // non stable asset
    token1Balance = Number(await getBalance(token1Contract, WALLET_ADDRESS)) / 10 ** Token1.decimals
    let lowerTick = priceToTick(currPrice * ((100 - width) / 100))
    let upperTick = priceToTick(currPrice * ((100 + width) / 100))
    let lowerPrice = currPrice * ((100 - width) / 100)
    let upperPrice = currPrice * ((100 + width) / 100)
    widthInTicks = Math.abs(Math.round((lowerTick - upperTick) / 2, 0)) / poolImmutables.tickSpacing
    console.log(lowerPrice, upperPrice, Date.now(), token0Balance, token1Balance, currPrice, tokenForAAVEBalance, healthFactor)

    await doc.useServiceAccountAuth(creds)
    const sheet = await doc.addSheet({ headerValues: ['lowerBound', 'upperBound', 'UnixTime', 'token0Balance', 'token1Balance', 'currentPrice', 'AAVECollateral', 'healthFactor'] })

    await sheet.addRow({ lowerBound: lowerPrice, upperBound: upperPrice , UnixTime: Date.now(), 
    token0Balance: token0Balance, token1Balance: token1Balance, currentPrice: currPrice, AAVECollateral: tokenForAAVEBalance, healthFactor: healthFactor })

    doLoop = true
    do { 
        try {
            await swapAndAdd(widthInTicks, token0Balance.toString(), token1Balance.toString(), WALLET_ADDRESS, WALLET_SECRET)
            doLoop = false; 
        } catch (err) {
            console.log(err)
            await timer(errTimeout)
        }
    } while (doLoop)

    while(true){
        poolState = await getPoolState()
        currPrice = poolState.sqrtPriceX96 * poolState.sqrtPriceX96 * (10 ** Token0.decimals) / (10 ** Token1.decimals) / 2 ** 192

        if (upperTick < priceToTick(currPrice) || priceToTick(currPrice) < lowerTick) {
            doLoop = true; 
            do { 
                try {
                    await removeAndBurn(WALLET_ADDRESS, WALLET_SECRET)
                    doLoop = false; 
                } catch (err) {
                    console.log(err)
                    await timer(errTimeout)
                }
            } while (doLoop)   

            userSummary = await getUserSummary(WALLET_ADDRESS)

            if (userSummary.healthFactor / liquidationTreshold - targetHealthFactor > rebalancingDelta){
                doLoop = true; 
                do { 
                    try {
                        await withdraw(tokenForAAVE.address, ethers.utils.parseUnits((userSummary.totalCollateralUSD - targetHealthFactor * userSummary.totalBorrowsUSD).toFixed(6).toString(), tokenForAAVE.decimals), WALLET_ADDRESS, WALLET_SECRET)
                        doLoop = false; 
                    } catch (err) {
                        console.log(err)
                        await timer(errTimeout)
                    }
                } while (doLoop)

                doLoop = true; 
                do { 
                    try {
                        await swap(tokenForAAVE, Token1, (userSummary.totalCollateralUSD - targetHealthFactor * userSummary.totalBorrowsUSD).toFixed(6).toString(), WALLET_ADDRESS, WALLET_SECRET)
                        doLoop = false; 
                    } catch (err) {
                        console.log(err)
                        await timer(errTimeout)
                    }
                } while (doLoop)
            } else if (userSummary.healthFactor / liquidationTreshold - targetHealthFactor < -rebalancingDelta){
                doLoop = true; 
                do { 
                    try {
                        await swap(Token1, tokenForAAVE, (targetHealthFactor * userSummary.totalBorrowsUSD - userSummary.totalCollateralUSD).toFixed(6).toString(), WALLET_ADDRESS, WALLET_SECRET)
                        doLoop = false; 
                    } catch (err) {
                        console.log(err)
                        await timer(errTimeout)
                    }
                } while (doLoop)

                tokenForAAVEBalance = Number(await getBalance(tokenForAAVEContract, WALLET_ADDRESS)) / 10 ** tokenForAAVE.decimals
                doLoop = true; 
                do { 
                    try {
                        await supply(tokenForAAVE.address, ethers.utils.parseUnits((tokenForAAVEBalance).toString(), tokenForAAVE.decimals), 0, WALLET_ADDRESS, WALLET_SECRET)
                        doLoop = false; 
                    } catch (err) {
                        console.log(err)
                        await timer(errTimeout)
                    }
                } while (doLoop)
            }

            userSummary = await getUserSummary(WALLET_ADDRESS)
            token0Balance = Number(await getBalance(token0Contract, WALLET_ADDRESS)) / 10 ** Token0.decimals   // non stable asset
            token1Balance = Number(await getBalance(token1Contract, WALLET_ADDRESS)) / 10 ** Token1.decimals

            lowerTick = priceToTick(currPrice * ((100 - width) / 100))
            upperTick = priceToTick(currPrice * ((100 + width) / 100))
            lowerPrice = currPrice * ((100 - width) / 100)
            upperPrice = currPrice * ((100 + width) / 100)
            widthInTicks = Math.abs(Math.round((lowerTick - upperTick) / 2, 0)) / poolImmutables.tickSpacing
            console.log(lowerPrice, upperPrice, Date.now(), token0Balance, token1Balance, currPrice, userSummary.totalCollateralUSD, userSummary.healthFactor) 

            await sheet.addRow({ lowerBound: lowerPrice, upperBound: upperPrice , UnixTime: Date.now(), 
            token0Balance: token0Balance, token1Balance: token1Balance, currentPrice: currPrice, AAVECollateral: userSummary.totalCollateralUSD, healthFactor: userSummary.healthFactor });
            
            doLoop = true; 
            do { 
                try {
                    await swapAndAdd(widthInTicks, token0Balance.toString(), token1Balance.toString(), WALLET_ADDRESS, WALLET_SECRET)
                    doLoop = false; 
                } catch (err) {
                    console.log(err)
                    await timer(errTimeout)
                }
            } while (doLoop)
        }
        await timer(15000)
    }
}

run(args)