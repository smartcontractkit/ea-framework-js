import { isAddress } from 'ethers'
import { address as solanaAddress } from '@solana/kit'

export const validateEthereumAddress = (address?: string | null) => isAddress(address)

export const validateEthereumWithdrawalCredentials = (address?: string | null) => {
  if (!address || address.length === 0) {
    return false
  }
  // 0x | 2 chars prefix | 22 chars padding | 40 chars address
  return (
    (address?.startsWith('0x01') || address?.startsWith('0x02')) &&
    address.length === 66 &&
    isAddress(`0x${address.slice(26)}`)
  )
}

export const validateBitcoinAddress = (address?: string | null) => {
  if (!address || address.length === 0) {
    return false
  }
  const addressPrefix = address[0]
  switch (addressPrefix) {
    // Legacy (P2PKH) and Nested SegWit (P2SH) Bitcoin addresses start with 1 and are case-sensitive
    case '1':
    case '3':
      return isBase58(address)
    case 'b':
    case 'B':
      return address.slice(0, 3) === 'bc1' && isBech32(address.slice(3))
    default:
      return false
  }
}

export const validateSolanaAddress = (address?: string | null) => {
  if (!address || address.length === 0) {
    return false
  }
  try {
    solanaAddress(address)
    return true
  } catch {
    return false
  }
}

const isBase58 = (value: string): boolean => /^[A-HJ-NP-Za-km-z1-9]*$/.test(value)
const isBech32 = (value: string): boolean => /^[qpzry9x8gf2tvdw0s3jn54khce6mua7l]+$/i.test(value)
