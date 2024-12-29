import {Wallet} from 'ethers'
import {menu} from './src/periphery/menu'
import {getProvider} from './src/periphery/utils'
import {scenarios} from './src/utils/constants'
import {c, defaultSleep, importAndValidatePrivateData, importProxies, RandomHelpers, retry, sleep} from './src/utils/helpers'
import {GarbageCollector} from './src/core/garbageCollector'
import {goodGwei, maxRetries, shuffleWallets, sleepBetweenAccs, sleepBetweenActions} from './config'
import {NativeSender} from './src/core/nativeSender'
import {getBalance, Multicall, waitGwei} from './src/periphery/web3Client'
import {RelayBridge} from './src/periphery/bridges/relayBridge'
import {StargateBridge} from './src/periphery/bridges/stargateBridge'

async function main() {
    let scenario = await menu.chooseTask()
    let proxies = await importProxies('./proxies.txt')
    let keysAndAddresses: {key: string; address: string}[]
    let provider = getProvider('Ethereum')
    let initialSigner: Wallet
    let garbageCollector: GarbageCollector
    let nativeSender: NativeSender

    switch (scenario) {
        case 'Balance cheker':
            keysAndAddresses = await importAndValidatePrivateData('./privates.txt', false)
            if (shuffleWallets) {
                keysAndAddresses = RandomHelpers.shuffleArray(keysAndAddresses)
            }
            initialSigner = new Wallet(keysAndAddresses[0].key)
            garbageCollector = new GarbageCollector(initialSigner, proxies)
            for (let i = 0; i < keysAndAddresses.length; i++) {
                let signer = new Wallet(keysAndAddresses[i].key, provider)
                console.log(c.cyan(`#${i + 1}/${keysAndAddresses.length} ${signer.address}`))
                garbageCollector.connect(signer)
                await garbageCollector.getNonZeroTokens()
            }
            break
        case 'Garbage collector':
            keysAndAddresses = await importAndValidatePrivateData('./privates.txt', false)
            if (shuffleWallets) {
                keysAndAddresses = RandomHelpers.shuffleArray(keysAndAddresses)
            }
            initialSigner = new Wallet(keysAndAddresses[0].key)
            garbageCollector = new GarbageCollector(initialSigner, proxies)
            for (let i = 0; i < keysAndAddresses.length; i++) {
                let signer = new Wallet(keysAndAddresses[i].key, provider)
                console.log(c.cyan(`#${i + 1}/${keysAndAddresses.length} ${signer.address}`))
                garbageCollector.connect(signer)
                await waitGwei(goodGwei)
                let anySwapHappened = await garbageCollector.getNonZeroTokensAndSwap()
                if (anySwapHappened) {
                    await sleep(RandomHelpers.getRandomNumber(sleepBetweenAccs))
                }
            }
            break
        case 'Garbage collector & native sender':
            keysAndAddresses = await importAndValidatePrivateData('./privates.txt', true)
            if (shuffleWallets) {
                keysAndAddresses = RandomHelpers.shuffleArray(keysAndAddresses)
            }
            initialSigner = new Wallet(keysAndAddresses[0].key)
            garbageCollector = new GarbageCollector(initialSigner, proxies)
            for (let i = 0; i < keysAndAddresses.length; i++) {
                let signer = new Wallet(keysAndAddresses[i].key, provider)
                console.log(c.cyan(`#${i + 1}/${keysAndAddresses.length} ${signer.address}`))
                garbageCollector.connect(signer)
                nativeSender = new NativeSender(signer, keysAndAddresses[i].address)
                await waitGwei(goodGwei)
                let anySwapHappened = await garbageCollector.getNonZeroTokensAndSwap()
                if (anySwapHappened) {
                    await defaultSleep(RandomHelpers.getRandomNumber(sleepBetweenActions), true)
                }
                await waitGwei(goodGwei)
                let anyNativeSent = await nativeSender.sendNative()
                if (anySwapHappened || anyNativeSent) {
                    await sleep(RandomHelpers.getRandomNumber(sleepBetweenAccs))
                }
            }
            break
        case 'Relay bridge':
            keysAndAddresses = await importAndValidatePrivateData('./privates.txt', false)
            if (shuffleWallets) {
                keysAndAddresses = RandomHelpers.shuffleArray(keysAndAddresses)
            }
            for (let i = 0; i < keysAndAddresses.length; i++) {
                let signer = new Wallet(keysAndAddresses[i].key, provider)
                console.log(c.cyan(`#${i + 1}/${keysAndAddresses.length} ${signer.address}`))
                await waitGwei(goodGwei)
                const relay = new RelayBridge(signer)
                let result = await relay.bridge(signer)
                if (result) {
                    await sleep(RandomHelpers.getRandomNumber(sleepBetweenAccs))
                }
            }
            break
        case 'Stargate bridge':
            keysAndAddresses = await importAndValidatePrivateData('./privates.txt', false)
            if (shuffleWallets) {
                keysAndAddresses = RandomHelpers.shuffleArray(keysAndAddresses)
            }
            for (let i = 0; i < keysAndAddresses.length; i++) {
                let signer = new Wallet(keysAndAddresses[i].key, provider)
                console.log(c.cyan(`#${i + 1}/${keysAndAddresses.length} ${signer.address}`))
                await waitGwei(goodGwei)
                const stargate = new StargateBridge(signer)
                let result = await stargate.bridge(signer)
                if (result) {
                    await sleep(RandomHelpers.getRandomNumber(sleepBetweenAccs))
                }
            }
            break
        default:
            console.log(`I could not understand you... \nAvailable scenarios are: ${c.magenta(scenarios.map((elem) => elem.name).join(' | '))}`)
    }
}

main()
