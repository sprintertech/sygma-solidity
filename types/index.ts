import {bigint} from "hardhat/internal/core/params/argumentTypes";
import {Hex} from "viem";

export type Proposal {
  originDomainID: number;
  depositNonce: bigint;
  resourceID: Hex;
  data: Hex;
}

export type Action {
  nativeValue: bigint;
  callTo: Hex;
  approveTo: Hex;
  tokenSend: Hex;
  tokenReceive: Hex;
  data: Hex;
}
