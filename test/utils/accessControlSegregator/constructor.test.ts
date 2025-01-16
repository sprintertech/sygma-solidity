// The Licensed Work is (c) 2022 Sygma
// SPDX-License-Identifier: LGPL-3.0-only

import {assert, expect} from 'chai';
import hre from 'hardhat';
import {ContractTypesMap} from 'hardhat/types';
import {Account, Hex, toHex, WalletClient} from 'viem';

describe("AccessControlSegregator - [constructor]", () => {
  let AccessControlSegregatorInstance: ContractTypesMap["AccessControlSegregator"];

  let authorizedAddress: WalletClient;
  let firstEOA: WalletClient;
  let secondEOA: WalletClient;
  let thirdEOA: WalletClient;

  const initialFunctions= [
    ("0x29a71964") as unknown as Hex,
    ("0x78728c73") as unknown as Hex,
    ("0x2a64052b") as unknown as Hex,
    ("0x3a24555a") as unknown as Hex,
  ];

  let initialAccessHolders: Array<Hex>;

  const grantAccessSig = "0xa973ec93" as unknown as Hex;

  beforeEach(async () => {
    [
      authorizedAddress,
      firstEOA,
      secondEOA,
      thirdEOA,
    ] = await hre.viem.getWalletClients();
    initialAccessHolders = [
      authorizedAddress.account!.address,
      firstEOA.account!.address,
      secondEOA.account!.address,
      thirdEOA.account!.address
    ];
    AccessControlSegregatorInstance = await hre.viem.deployContract("AccessControlSegregator", [
      initialFunctions,
      initialAccessHolders
    ]);
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
        initialAccessHolders[0]
      ])
    );
  });

  it("should grant function access specified in params", async () => {
    for (let i = 0; i < initialFunctions.length; i++) {
      assert.isTrue(
        await AccessControlSegregatorInstance.read.hasAccess([
          initialFunctions[i],
          initialAccessHolders[i]
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
