// The Licensed Work is (c) 2022 Sygma
// SPDX-License-Identifier: LGPL-3.0-only

import hre from 'hardhat';
import {ContractTypesMap} from "hardhat/types";
import {deploySourceChainContracts} from "../../../helpers";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {Hex, WalletClient} from "viem";
import {assert, expect} from 'chai';

const Helpers = require("../../../helpers");


describe("PercentageFeeHandler - [admin]", () => {
  const originDomainID = 1;
  const destinationDomainID = 2;
  const fee = BigInt(60000);

  let BridgeInstance: ContractTypesMap["Bridge"];
  let PercentageFeeHandlerInstance: ContractTypesMap["PercentageERC20FeeHandler"];
  let ERC20MintableInstance: ContractTypesMap["ERC20PresetMinterPauser"];
  let FeeHandlerRouterInstance: ContractTypesMap["FeeHandlerRouter"];
  let ADMIN_ROLE: Hex;
  let resourceID: Hex;

  let feeHandlerAdmin: WalletClient;
  let newFeeHandlerAdmin: WalletClient;

  before(async () => {
    ({
      BridgeInstance,
      PercentageFeeHandlerInstance,
      ERC20MintableInstance,
    } = await loadFixture(deploySourceChainContracts));
    [
      feeHandlerAdmin,
      newFeeHandlerAdmin,
    ] = await hre.viem.getWalletClients();

    ADMIN_ROLE = await PercentageFeeHandlerInstance.read.DEFAULT_ADMIN_ROLE();

    resourceID = createResourceID(ERC20MintableInstance.address, originDomainID);
  });

  it("[sanity] should return fee handler type from fee handler", async () => {
    assert.equal(await PercentageFeeHandlerInstance.read.feeHandlerType(), "percentage");
  });

  it("[sanity] should return type from fee handler router", async () => {
    assert.equal(await FeeHandlerRouterInstance.read.feeHandlerType(), "router");
  });

  it("should set fee property", async () => {
    assert.equal(await PercentageFeeHandlerInstance.read._domainResourceIDToFee([destinationDomainID, resourceID]), BigInt(0));
    await PercentageFeeHandlerInstance.write.changeFee([destinationDomainID, resourceID, fee]);
    assert.equal(await PercentageFeeHandlerInstance.read._domainResourceIDToFee([destinationDomainID, resourceID]), fee);
  });

  it("should require admin role to change fee property", async () => {
    await expect(
      PercentageFeeHandlerInstance.write.changeFee([destinationDomainID, resourceID, fee])
    ).to.be.revertedWith("sender doesn't have admin role");
  });

  it("should set fee bounds", async () => {
    const newLowerBound = BigInt(100);
    const newUpperBound = BigInt(300);
    assert.equal((await PercentageFeeHandlerInstance.read._resourceIDToFeeBounds([resourceID]))[0], BigInt(0));
    assert.equal((await PercentageFeeHandlerInstance.read._resourceIDToFeeBounds([resourceID]))[1], BigInt(0));
    await PercentageFeeHandlerInstance.write.changeFeeBounds([resourceID, newLowerBound, newUpperBound]);
    assert.equal(
      (await PercentageFeeHandlerInstance.read._resourceIDToFeeBounds([resourceID]))[0],
      newLowerBound
    );
    assert.equal(
      (await PercentageFeeHandlerInstance.read._resourceIDToFeeBounds([resourceID]))[1],
      newUpperBound
    );
  });

  it("should require admin role to change fee bounds", async () => {
    const lowerBound = BigInt(100);
    const upperBound = BigInt(300);
    await expect(
      PercentageFeeHandlerInstance.write.changeFeeBounds([resourceID, lowerBound, upperBound])
    ).to.be.revertedWith("sender doesn't have admin role");
  });

  it("PercentageFeeHandler admin should be changed to newFeeHandlerAdmin", async () => {

    // check current admin
    assert.isTrue(
      await PercentageFeeHandlerInstance.read.hasRole([ADMIN_ROLE, feeHandlerAdmin.account!.address])
    );

    await expect(
      PercentageFeeHandlerInstance.write.renounceAdmin([newFeeHandlerAdmin.account!.address])
    ).not.to.be.reverted;

    assert.isTrue(
      await PercentageFeeHandlerInstance.read.hasRole([
        ADMIN_ROLE,
        newFeeHandlerAdmin.account!.address
      ])
    );

    // check that former admin is no longer admin
    assert.isFalse(
      await PercentageFeeHandlerInstance.read.hasRole([ADMIN_ROLE, feeHandlerAdmin.account!.address])
    );
  });
});
