const { spawnSync } = require('child_process')
const ATR = spawnSync('python3', ['ATRwithEMA.py']);
const { abi: module_abi } =  require('./abi/WhitelistingModuleV2.json')
const timer = ms => new Promise(res => setTimeout(res, ms)) 

async function test(){
    let a = 0
    doLoop = true
    do { 
        let s = module_abi
        let a = 1
        console.log(a)
        await timer(3000)
    } while (doLoop)
}

test()
