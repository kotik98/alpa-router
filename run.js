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

async function errCatcher(f, arguments) {
    doLoop = true
    do { 
        try {
            return await f.apply(this, arguments)
        } catch (err) {
            console.log(err)
            await timer(180000)
        }
    } while (doLoop)
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
    await errCatcher(approveMax, [token0Contract, V3_SWAP_ROUTER_ADDRESS, WALLET_SECRET])
    await errCatcher(approveMax, [token1Contract, V3_SWAP_ROUTER_ADDRESS, WALLET_SECRET])
    await errCatcher(approveMax, [tokenForAAVEContract, V3_SWAP_ROUTER_ADDRESS, WALLET_SECRET])

    // approve for supply on aave
    await errCatcher(approveMax, [tokenForAAVEContract, AAVEpoolAddress, WALLET_SECRET])

    // approve for repay on aave
    await errCatcher(approveMax, [token0Contract, AAVEpoolAddress, WALLET_SECRET])

    let epsilon = 1    // allowable missmatch in USD
    let liquidationTreshold = 0.85    // liq treshold for collateral
    let targetHealthFactor = healthFactor / liquidationTreshold
    let userSummary
    let poolState = await errCatcher(getPoolState, [])
    let poolImmutables = await errCatcher(getPoolImmutables, [])
    let currPrice = poolState.sqrtPriceX96 * poolState.sqrtPriceX96 * (10 ** Token0.decimals) / (10 ** Token1.decimals) / 2 ** 192
    let token0Balance = Number(await errCatcher(getBalance, [token0Contract, WALLET_ADDRESS])) / 10 ** Token0.decimals   // non stable asset
    let token1Balance = Number(await errCatcher(getBalance, [token1Contract, WALLET_ADDRESS])) / 10 ** Token1.decimals
    let tokenForAAVEBalance = Number(await errCatcher(getBalance, [tokenForAAVEContract, WALLET_ADDRESS])) / 10 ** tokenForAAVE.decimals
    let delta = (targetHealthFactor * (token0Balance * currPrice + token1Balance) - tokenForAAVEBalance) / (1 + targetHealthFactor)
    delta = delta.toFixed(6)

    if (Math.abs(delta) > epsilon) {
        if (delta > 0) {
            if (delta > token0Balance * currPrice && delta > token1Balance) {
                await Promise.all([errCatcher(swap, [Token0, tokenForAAVE, token0Balance.toFixed(6).toString(), WALLET_ADDRESS, WALLET_SECRET]),
                    errCatcher(swap, [Token1, tokenForAAVE, (delta - token0Balance * currPrice).toFixed(6).toString(), WALLET_ADDRESS, WALLET_SECRET])])
                
            } else if (delta > token0Balance * currPrice && delta < token1Balance) {
                await errCatcher(swap, [Token1, tokenForAAVE, delta.toString(), WALLET_ADDRESS, WALLET_SECRET])
            } else {
                await errCatcher(swap, [Token0, tokenForAAVE, delta.toString(), WALLET_ADDRESS, WALLET_SECRET])
            }
        } else {
            await errCatcher(swap, [tokenForAAVE, Token1, Math.abs(delta).toString(), WALLET_ADDRESS, WALLET_SECRET])
        }
    }

    tokenForAAVEBalance = Number(await errCatcher(getBalance, [tokenForAAVEContract, WALLET_ADDRESS])) / 10 ** tokenForAAVE.decimals
    await errCatcher(supply, [tokenForAAVE.address,  ethers.utils.parseUnits(tokenForAAVEBalance.toString(), tokenForAAVE.decimals), 0, WALLET_ADDRESS, WALLET_SECRET])

    poolState = await errCatcher(getPoolState, [])
    currPrice = poolState.sqrtPriceX96 * poolState.sqrtPriceX96 * (10 ** Token0.decimals) / (10 ** Token1.decimals) / 2 ** 192
    await errCatcher(borrow, [Token0.address, ethers.utils.parseUnits((tokenForAAVEBalance / targetHealthFactor / currPrice).toFixed(6).toString(), Token0.decimals), 2, 0, WALLET_ADDRESS, WALLET_SECRET])

    token0Balance = Math.max(Number(await errCatcher(getBalance, [token0Contract, WALLET_ADDRESS])) / 10 ** Token0.decimals - 0.001, 0)   // non stable asset
    token1Balance = Math.max(Number(await errCatcher(getBalance, [token1Contract, WALLET_ADDRESS])) / 10 ** Token1.decimals - 0.001, 0)
    let lowerTick = priceToTick(currPrice * ((100 - width) / 100))
    let upperTick = priceToTick(currPrice * ((100 + width) / 100))
    let lowerPrice = currPrice * ((100 - width) / 100)
    let upperPrice = currPrice * ((100 + width) / 100)
    let widthInTicks = Math.round(Math.abs((lowerTick - upperTick) / 2) / poolImmutables.tickSpacing, 0)
    console.log(lowerPrice, upperPrice, Date.now(), token0Balance, token1Balance, currPrice, tokenForAAVEBalance, healthFactor)

    await doc.useServiceAccountAuth(creds)
    const sheet = await doc.addSheet({ title: 'hourly test', headerValues: ['lowerBound', 'upperBound', 'UnixTime', 'dateTime', 'token0Balance', 'token1Balance', 'currentPrice', 'AAVECollateral', 'healthFactor', 'total'] })

    await sheet.addRow({ lowerBound: lowerPrice.toFixed(6), upperBound: upperPrice.toFixed(6), UnixTime: Date.now(), dateTime: Date(Date.now()),
    token0Balance: token0Balance.toFixed(2), token1Balance: token1Balance.toFixed(2), currentPrice: currPrice.toFixed(6), AAVECollateral: tokenForAAVEBalance.toFixed(2), healthFactor: healthFactor.toFixed(3),
    total: (token0Balance * currPrice + token1Balance + tokenForAAVEBalance - tokenForAAVEBalance / targetHealthFactor).toFixed(2) })

    await errCatcher(swapAndAdd, [widthInTicks, token0Balance.toString(), token1Balance.toString(), WALLET_ADDRESS, WALLET_SECRET])

    let sumBalance, swapToken
    while(true){
        poolState = await errCatcher(getPoolState, [])
        currPrice = poolState.sqrtPriceX96 * poolState.sqrtPriceX96 * (10 ** Token0.decimals) / (10 ** Token1.decimals) / 2 ** 192

        if (upperTick < priceToTick(currPrice) || priceToTick(currPrice) < lowerTick) {
            await errCatcher(removeAndBurn, [WALLET_ADDRESS, WALLET_SECRET]) 

            userSummary = await errCatcher(getUserSummary, [WALLET_ADDRESS])
            token0Balance = Math.max(Number(await errCatcher(getBalance, [token0Contract, WALLET_ADDRESS])) / 10 ** Token0.decimals - 0.001, 0)   // non stable asset
            token1Balance = Math.max(Number(await errCatcher(getBalance, [token1Contract, WALLET_ADDRESS])) / 10 ** Token1.decimals - 0.001, 0)
            sumBalance = token0Balance * currPrice + token1Balance
            deltaCollateral = (targetHealthFactor * (sumBalance - Number(userSummary.totalBorrowsUSD)) - Number(userSummary.totalCollateralUSD)) / (1 + targetHealthFactor)
            deltaBorrowing = 2 / targetHealthFactor * (Number(userSummary.totalCollateralUSD) + deltaCollateral) - sumBalance + deltaCollateral

            if ((userSummary.healthFactor / liquidationTreshold - targetHealthFactor > rebalancingDelta) ||
                (userSummary.healthFactor / liquidationTreshold - targetHealthFactor < -rebalancingDelta) ||
                (Math.abs(deltaBorrowing) + Math.abs(deltaCollateral) > 0.05 * (sumBalance + deltaBorrowing - deltaCollateral))){
                if (deltaCollateral > 0){
                    if (token1Balance > deltaCollateral) {
                        swapToken = Token1
                    } else {
                        swapToken = Token0
                    }
                    await errCatcher(swap, [swapToken, tokenForAAVE, (deltaCollateral).toFixed(6).toString(), WALLET_ADDRESS, WALLET_SECRET])

                    tokenForAAVEBalance = Number(await getBalance(tokenForAAVEContract, WALLET_ADDRESS)) / 10 ** tokenForAAVE.decimals
                    await errCatcher(supply, [tokenForAAVE.address, ethers.utils.parseUnits(tokenForAAVEBalance.toFixed(6).toString(), tokenForAAVE.decimals), 0, WALLET_ADDRESS, WALLET_SECRET])
                } else {
                    await errCatcher(withdraw, [tokenForAAVE.address, ethers.utils.parseUnits(Math.abs(deltaCollateral).toFixed(6).toString(), tokenForAAVE.decimals), WALLET_ADDRESS, WALLET_SECRET])

                    tokenForAAVEBalance = Number(await getBalance(tokenForAAVEContract, WALLET_ADDRESS)) / 10 ** tokenForAAVE.decimals
                    await errCatcher(swap, [tokenForAAVE, Token1, tokenForAAVEBalance.toFixed(6).toString(), WALLET_ADDRESS, WALLET_SECRET])
                }
                if (deltaBorrowing < 0){
                    if (token0Balance < Math.abs(deltaBorrowing / currPrice)) {
                        await errCatcher(swap, [Token1, Token0, Math.abs(deltaBorrowing).toFixed(6).toString(), WALLET_ADDRESS, WALLET_SECRET])
                    }

                    await errCatcher(repay, [Token0.address, ethers.utils.parseUnits(Math.abs(deltaBorrowing / currPrice * 0.995).toFixed(6).toString(), Token0.decimals), 2, WALLET_ADDRESS, WALLET_SECRET])
                } else {
                    await errCatcher(borrow, [Token0.address, ethers.utils.parseUnits((deltaBorrowing / currPrice).toFixed(6).toString(), Token0.decimals), 2, 0, WALLET_ADDRESS, WALLET_SECRET])
                }

            }

            userSummary = await errCatcher(getUserSummary, [WALLET_ADDRESS])
            token0Balance = Math.max(Number(await errCatcher(getBalance, [token0Contract, WALLET_ADDRESS])) / 10 ** Token0.decimals - 0.001, 0)   // non stable asset
            token1Balance = Math.max(Number(await errCatcher(getBalance, [token1Contract, WALLET_ADDRESS])) / 10 ** Token1.decimals - 0.001, 0)

            lowerTick = priceToTick(currPrice * ((100 - width) / 100))
            upperTick = priceToTick(currPrice * ((100 + width) / 100))
            lowerPrice = currPrice * ((100 - width) / 100)
            upperPrice = currPrice * ((100 + width) / 100)
            widthInTicks = Math.round(Math.abs((lowerTick - upperTick) / 2) / poolImmutables.tickSpacing, 0)
            console.log(lowerPrice, upperPrice, Date.now(), token0Balance, token1Balance, currPrice, userSummary.totalCollateralUSD, userSummary.healthFactor, deltaCollateral, deltaBorrowing) 

            await sheet.addRow({ lowerBound: lowerPrice.toFixed(6), upperBound: upperPrice.toFixed(6) , UnixTime: Date.now(), dateTime: Date(Date.now()), 
            token0Balance: token0Balance.toFixed(2), token1Balance: token1Balance.toFixed(2), currentPrice: currPrice.toFixed(6), AAVECollateral: Number(userSummary.totalCollateralUSD).toFixed(2), healthFactor: Number(userSummary.healthFactor).toFixed(3),
            total: (token0Balance * currPrice + token1Balance + Number(userSummary.totalCollateralUSD) - Number(userSummary.totalCollateralUSD) * liquidationTreshold / Number(userSummary.healthFactor)).toFixed(2) });
            
            await errCatcher(swapAndAdd, [widthInTicks, token0Balance.toString(), token1Balance.toString(), WALLET_ADDRESS, WALLET_SECRET])
        }
        await timer(15000)
    }
}

run(args)