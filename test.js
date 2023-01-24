const { spawnSync } = require('child_process')
const ATR = spawnSync('python3', ['ATRwithEMA.py']);

const timer = ms => new Promise(res => setTimeout(res, ms)) 

async function test(){
    doLoop = true
    do { 
        try {
            width = Number(ATR.stdout)
            console.log(width)
            if (width != 0){
                doLoop = false
            }
        } catch (err) {
            console.log(err)
            await timer(1000)
        }
    } while (doLoop)
}

test()
