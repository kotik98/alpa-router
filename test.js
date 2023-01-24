const { spawnSync } = require('child_process')
const ATR = spawnSync('python3', ['ATRwithEMA.py']);

const timer = ms => new Promise(res => setTimeout(res, ms)) 

async function test(){
        doLoop = true
        do { 
            try {
                console.log(Number(ATR.stdout))
                doLoop = false
            } catch (err) {
                console.log(err)
                await timer(10000)
            }
        } while (doLoop)
}

test()
