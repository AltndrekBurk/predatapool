// TODO: Add `isEqual` to `TempoAddress`.
import type { TempoAddress } from 'ox/tempo'

export function isEqual(a: TempoAddress.Address, b: TempoAddress.Address) {
  return a.toLowerCase() === b.toLowerCase()
}
