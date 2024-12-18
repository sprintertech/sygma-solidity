// The Licensed Work is (c) 2022 Sygma
// SPDX-License-Identifier: LGPL-3.0-only

import {assert, expect} from "chai";
import hre from 'hardhat';
import {ContractTypesMap} from "hardhat/types";
import {WalletClient} from "viem";


describe("AccessControlSegregator - [grant access]", () => {
  let AccessControlSegregatorInstance: ContractTypesMap["AccessControlSegregator"];

  let firstEOA: WalletClient;
  let secondEOA: WalletClient;
  let thirdEOA: WalletClient;

  const functionSignature = "0x29a71964";

  beforeEach(async () => {
    AccessControlSegregatorInstance = await hre.viem.deployContract("AccessControlSegregator", [[],[]]);
    [
      ,
      firstEOA,
      secondEOA,
      thirdEOA
    ] = await hre.viem.getWalletClients();
  });

  it("hasAccess should return false if access not granted", async () => {
    assert.isFalse(
      await AccessControlSegregatorInstance.read.hasAccess([
        functionSignature,
        firstEOA.account!.address
      ])
    );
  });

  it("should revert if sender doesn't have  grant access rights", async () => {
    await expect(
      AccessControlSegregatorInstance.write.grantAccess([
        functionSignature,
        secondEOA.account!.address],
        {account: firstEOA.account}
      ),
    ).to.be.revertedWith("sender doesn't have grant access rights");
  });

  it("should successfully grant access to a function", async () => {
    await expect(
      AccessControlSegregatorInstance.write.grantAccess([
        functionSignature,
        secondEOA.account!.address
      ])
    ).not.to.be.reverted;

    assert.isTrue(
      await AccessControlSegregatorInstance.read.hasAccess([
        functionSignature,
        secondEOA.account!.address
      ])
    );
  });

  it("should successfully regrant access", async () => {
    await expect(
      AccessControlSegregatorInstance.write.grantAccess([
        functionSignature,
        secondEOA.account!.address
      ])
    ).not.to.be.reverted;
    assert.isTrue(
      await AccessControlSegregatorInstance.read.hasAccess([
        functionSignature,
        secondEOA.account!.address
      ])
    );

    await expect(
      AccessControlSegregatorInstance.write.grantAccess([
        functionSignature,
        thirdEOA.account!.address
      ])
    ).not.to.be.reverted;
    assert.isTrue(
      await AccessControlSegregatorInstance.read.hasAccess([
        functionSignature,
        thirdEOA.account!.address
      ])
    );
  });
});
