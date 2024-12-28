import {formatEther, parseEther, Wallet} from 'ethers'
import {chains} from '../utils/constants'
import axios from 'axios'
import {estimateTx, getBalance, sendRawTx} from './web3Client'
import {bigintToPrettyStr, c, defaultSleep, RandomHelpers, retry} from '../utils/helpers'
import {maxRetries, RelayBridgeConfig, sleepBetweenActions} from '../../config'
import {ChainName} from '../utils/types'
import {getProvider} from './utils'

class RelayBridge extends RelayBridgeConfig {
    signer: Wallet
    constructor(signer: Wallet) {
        super()
        this.signer = signer
    }
    async bridgeRelay(signer: Wallet, currency = 'ETH', fromNetwork: ChainName, toNetwork: ChainName, value: bigint): Promise<boolean> {
        let result: boolean | undefined = await retry(
            async () => {
                const fromChainId = chains[fromNetwork].id.toString()
                const toChainId = chains[toNetwork].id.toString()
                let avgBridgeFee = 501_383_102_086_736n
                if (value - avgBridgeFee <= 0n) {
                    avgBridgeFee = 50_000_000_000_000n
                    if (value - avgBridgeFee <= 0n) {
                        // prettier-ignore
                        console.log(
                            c.red(`[relay] Can't from ${fromNetwork} to ${toNetwork} ${bigintToPrettyStr(value, undefined, 6)} ${currency}: Small amount`)
                        )
                        return false
                    }
                }
                const quoteBridgeResp = await axios.post(
                    'https://api.relay.link/quote',
                    {
                        user: await signer.getAddress(),
                        originChainId: fromChainId,
                        destinationChainId: toChainId,
                        originCurrency: '0x0000000000000000000000000000000000000000',
                        destinationCurrency: '0x0000000000000000000000000000000000000000',
                        recipient: await signer.getAddress(),
                        tradeType: 'EXACT_OUTPUT',
                        amount: (value - avgBridgeFee).toString(),
                        usePermit: false,
                        useExternalLiquidity: false,
                        referrer: 'relay.link/bridge'
                    },
                    {
                        headers: {
                            Host: 'api.relay.link',
                            Origin: 'https://relay.link',
                            Referer: 'https://relay.link/',
                            'Content-Type': 'application/json',
                            'User-Agent':
                                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
                        }
                    }
                )
                let bridgeFee = BigInt(quoteBridgeResp.data?.fees.relayer.amount)
                let valueToBridge = this.deductFee ? value - bridgeFee : value
                if (valueToBridge <= 0n) {
                    console.log(
                        c.red(
                            `[relay] Can't from ${fromNetwork} to ${toNetwork} ${bigintToPrettyStr(
                                valueToBridge,
                                undefined,
                                6
                            )} ${currency}: Small amount`
                        )
                    )
                    return false
                }
                const bridgeResp = await axios.post(
                    'https://api.relay.link/quote',
                    {
                        user: await signer.getAddress(),
                        originChainId: fromChainId,
                        destinationChainId: toChainId,
                        originCurrency: '0x0000000000000000000000000000000000000000',
                        destinationCurrency: '0x0000000000000000000000000000000000000000',
                        recipient: await signer.getAddress(),
                        tradeType: 'EXACT_OUTPUT',
                        amount: valueToBridge.toString(),
                        usePermit: false,
                        useExternalLiquidity: false,
                        referrer: 'relay.link/bridge'
                    },
                    {
                        headers: {
                            Host: 'api.relay.link',
                            Origin: 'https://relay.link',
                            Referer: 'https://relay.link/',
                            'Content-Type': 'application/json',
                            'User-Agent':
                                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
                        }
                    }
                )
                let tx = bridgeResp.data?.steps[0].items[0].data
                if (tx?.gasPrice != undefined) {
                    if (tx.gasPrice?.type == 'BigNumber') {
                        tx.gasPrice = tx.gasPrice.hex
                    }
                }
                let testTx = {...tx}
                testTx.value = 1000000000n
                let estimate = await estimateTx(signer, testTx)
                let cost = (BigInt(tx?.gasPrice ?? tx?.maxFeePerGas) * BigInt(estimate) * 16n) / 10n
                tx.value = this.deductFee ? BigInt(tx?.value) - cost : BigInt(tx?.value)
                if (tx.value <= 0n) {
                    console.log(
                        c.red(
                            `[relay] Can't from ${fromNetwork} to ${toNetwork} ${bigintToPrettyStr(
                                tx.value,
                                undefined,
                                6
                            )} ${currency}: Value is too small after fee deduction`
                        )
                    )
                    return false
                }
                tx.gasLimit = estimate
                console.log(c.yellow(`[relay] bridging ${formatEther(tx.value)} ETH from ${fromNetwork} to ${toNetwork}`))
                let hash = await sendRawTx(signer, tx, true)
                console.log(
                    c.green(`[relay] ${formatEther(tx.value)} ${currency}: ${fromNetwork} --> ${toNetwork} ${chains[fromNetwork].explorer + hash}`)
                )
                return true
            },
            {maxRetryCount: maxRetries, retryInterval: 10, throwOnError: false}
        )
        if (result == undefined) {
            console.log(c.red(`[relay] Bridge from ${fromNetwork} to ${toNetwork} failed`))
            return false
        } else {
            return result
        }
    }

    async executeRelayBridge(signer: Wallet, currency = 'ETH') {
        let networks = RandomHelpers.shuffleArray(this.fromNetworks)
        let hasBridged = false
        for (let i = 0; i < networks.length; i++) {
            let fromNetwork = networks[i] as ChainName
            let toNetwork = this.toNetwork
            // since relay bridge is good only for eth, require that from user
            if (
                chains[fromNetwork].currency.name.toLowerCase() != currency.toLowerCase() ||
                chains[toNetwork].currency.name.toLowerCase() != currency.toLowerCase()
            ) {
                console.log(
                    '[relay]',
                    c.red('You can bridge only ETH on ETH-specific chains.', `${fromNetwork} or ${toNetwork} is not ETH-specific.`)
                )
                return false
            }
            let valueToBridge = await this.getSendValue(fromNetwork)
            if (valueToBridge < 0n) {
                console.log(c.red(`[relay] value to bridge must be > 0. Got: ${formatEther(valueToBridge)}`))
                continue
            }
            if (valueToBridge < parseEther(this.minToBridge)) {
                console.log(
                    c.yellow(`[relay] value to bridge from ${fromNetwork} is below limit of ${this.minToBridge} ${chains[fromNetwork].currency.name}`)
                )
                continue
            }
            let success = await this.bridgeRelay(signer.connect(getProvider(fromNetwork)), currency, fromNetwork, toNetwork, valueToBridge)
            if (success) {
                await defaultSleep(RandomHelpers.getRandomNumber(sleepBetweenActions))
                hasBridged = true
            }
        }
        return hasBridged
    }

    async getSendValue(networkName: ChainName): Promise<bigint> {
        // if (parseFloat(this.values.from) < 0 || parseFloat(this.values.to) < 0) {
        //     console.log(c.red(`Can't pass negative numbers to Relay Bridge`))
        //     throw Error(`Can't pass negative numbers to Relay Bridge`)
        // }
        if (this.values.from.includes('%') && this.values.to.includes('%')) {
            let precision = 1000
            let balance = await getBalance(getProvider(networkName), this.signer.address)
            let randomPortion = BigInt(
                (RandomHelpers.getRandomNumber({from: parseFloat(this.values.from), to: parseFloat(this.values.to)}, 3) * precision).toString()
            )
            let value = (balance * randomPortion) / (100n * BigInt(precision))
            return value
        } else if (this.values.from.includes('-') && this.values.to.includes('-')) {
            let balance = await getBalance(getProvider(networkName), this.signer.address)
            let i = 0
            while (i < 10) {
                let toLeaveFrom = balance - parseEther(this.values.to.replace('-', '')) // balance - max_to_leave
                let toLeaveTo = balance - parseEther(this.values.from.replace('-', '')) // balance - min_to_leave

                let randomValue = BigInt(RandomHelpers.getRandomBigInt({from: toLeaveFrom, to: toLeaveTo}).toString())
                if (randomValue < 0n) {
                    i++
                    continue
                }
                return randomValue
            }
            return 0n
        } else if (
            !this.values.from.includes('%') &&
            !this.values.to.includes('%') &&
            !this.values.from.includes('-') &&
            !this.values.to.includes('-')
        ) {
            let value = parseEther(RandomHelpers.getRandomNumber({from: parseFloat(this.values.from), to: parseFloat(this.values.to)}).toString())
            return value
        } else {
            console.log(c.red(`Your "values" in "RelayBridgeConfig" are wrong. Should be *number* or *percentage*`))
            throw Error(`Your "values" in "RelayBridgeConfig" are wrong. Should be *number* or *percentage*`)
        }
    }
}
export {RelayBridge}
