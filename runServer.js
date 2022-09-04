const { Token0, Token1, token0Contract, token1Contract, getPoolState, getBalance, getGasPrice, getPoolImmutables, swapAndAdd, removeAndBurn, approveMax } = require('./contractCommunication');

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

async function run(args) {  // args: [ width_in_percentage, WALLET_ADDRESS, WALLET_SECRET ]

    const WALLET_ADDRESS = args[1]
    const WALLET_SECRET = args[2]

    // раскомментить при первом вызове
    // await approveMax(token0Contract, WALLET_SECRET)
    // await approveMax(token1Contract, WALLET_SECRET)

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
    console.log(lowerPrice, upperPrice, Date.now(), Number(token0Balance) / (10 ** Token0.decimals), Number(token1Balance) /(10 ** Token1.decimals), currPrice)

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
          let lowerPrice = currPrice * ((100 - Number(args[0])) / 100)
          let upperPrice = currPrice * ((100 + Number(args[0])) / 100)
          width = Math.abs(Math.round((lowerTick - upperTick) / 2, 0)) / poolImmutables.tickSpacing
          console.log(lowerPrice, upperPrice, Date.now(), token0Balance.toString() / Token0.decimals, token1Balance.toString() / Token1.decimals, currPrice)
          
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

run(args)

//removeAndBurn()