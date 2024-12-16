// The Licensed Work is (c) 2022 Sygma
// SPDX-License-Identifier: LGPL-3.0-only

import {assert, expect} from 'chai';
import hre from 'hardhat';
import {ContractTypesMap} from 'hardhat/types';
import {Account, Hex, toHex, WalletClient} from 'viem';

describe("AccessControlSegregator - [constructor]", () => {
  let AccessControlSegregatorInstance: ContractTypesMap["AccessControlSegregator"];

  let firstEOA: WalletClient;
  let secondEOA: WalletClient;
  let thirdEOA: WalletClient;
  let fourthEOA: WalletClient;

  const initialFunctions= [
    toHex("29a71964"),
    toHex("0x78728c73"),
    toHex("0x2a64052b"),
    toHex("0x3a24555a"),
  ];

  let initialAccessHolders: Array<WalletClient>;

  const grantAccessSig = "0xa973ec93";

  before(async () => {
    AccessControlSegregatorInstance = await hre.viem.deployContract("AccessControlSegregator", [[],[]]);
      [
        ,
        firstEOA,
        secondEOA,
        thirdEOA,
        fourthEOA,
      ] = await hre.viem.getWalletClients();

    initialAccessHolders = [firstEOA, secondEOA, thirdEOA, fourthEOA];
  });

  it("should revert if length of functions and accounts array is different", async () => {
    await expect(
      hre.viem.deployContract("AccessControlSegregator", [
        [initialFunctions[0], initialFunctions[1]],
        [firstEOA.account!.address]
      ]),
    ).to.be.revertedWith("array length should be equal");
  });

  it("should grant deployer grant access rights", async () => {
    assert.isTrue(
      await AccessControlSegregatorInstance.read.hasAccess([
        grantAccessSig,
        initialAccessHolders[0].account!.address
      ])
    );
  });

  it("should grant function access specified in params", async () => {
    for (let i = 0; i < initialFunctions.length; i++) {
      assert.isTrue(
        await AccessControlSegregatorInstance.read.hasAccess([
          initialFunctions[i],
          initialAccessHolders[i].account!.address
        ])
      );
    }
  });

  it("should replace grant access of deployer if specified in params", async () => {
    const AccessControlSegregatorInstance = await hre.viem.deployContract("AccessControlSegregator", [
      [grantAccessSig],
      [secondEOA.account!.address]
    ]);

    assert.isFalse(
      await AccessControlSegregatorInstance.read.hasAccess([grantAccessSig, firstEOA.account!.address])
    );
    assert.isTrue(
      await AccessControlSegregatorInstance.read.hasAccess([grantAccessSig, secondEOA.account!.address])
    );
  });
});
