// The Licensed Work is (c) 2022 Sygma
// SPDX-License-Identifier: LGPL-3.0-only

import hre from 'hardhat';
import {ContractTypesMap} from "hardhat/types";
import {Hex, WalletClient} from "viem";
import {deploySourceChainContracts} from "../../../helpers";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {assert, expect} from "chai";


describe("BasicFeeHandler - [admin]", () => {
  const originDomainID = 1;
  const destinationDomainID = 2;
  const fee = BigInt(3);

  let relayer1: WalletClient;
  let feeHandlerAdmin: WalletClient;
  let newFeeHandlerAdmin: WalletClient;

  let BridgeInstance: ContractTypesMap["Bridge"];
  let BasicFeeHandlerInstance: ContractTypesMap["BasicFeeHandler"];
  let FeeHandlerRouterInstance: ContractTypesMap["FeeHandlerRouter"];
  let ERC20MintableInstance: ContractTypesMap["ERC20PresetMinterPauser"];
  let ADMIN_ROLE: Hex;
  let resourceID: Hex;

  beforeEach(async () => {
    ({
      BridgeInstance,
      BasicFeeHandlerInstance,
      ERC20MintableInstance,
    } = await loadFixture(deploySourceChainContracts));
    [
      feeHandlerAdmin,
      newFeeHandlerAdmin,
      relayer1,
    ] = await hre.viem.getWalletClients();

    ADMIN_ROLE = await BasicFeeHandlerInstance.read.DEFAULT_ADMIN_ROLE();
    resourceID = createResourceID(
      ERC20MintableInstance.address,
      originDomainID
    )
  });

  it("[sanity] should return fee handler type from fee handler", async () => {
    assert.equal(await BasicFeeHandlerInstance.read.feeHandlerType(), "basic");
  });

  it("[sanity] should return type from fee handler router", async () => {
    assert.equal(await FeeHandlerRouterInstance.read.feeHandlerType(), "router");
  });

  it("should set fee property", async () => {
    assert.equal(await BasicFeeHandlerInstance.read._domainResourceIDToFee([destinationDomainID, resourceID]), BigInt(0));
    await BasicFeeHandlerInstance.write.changeFee([destinationDomainID, resourceID, fee]);
    assert.equal(await BasicFeeHandlerInstance.read._domainResourceIDToFee([destinationDomainID, resourceID]), fee);
  });

  it("should require admin role to change fee property", async () => {
    await expect(
      BasicFeeHandlerInstance.write.changeFee([destinationDomainID, resourceID, fee])
    ).to.be.revertedWith("sender doesn't have admin role");
  });

  it("BasicFeeHandler admin should be changed to expectedBasicFeeHandlerAdmin", async () => {
    // check current admin
    assert.isTrue(
      await BasicFeeHandlerInstance.read.hasRole([ADMIN_ROLE, feeHandlerAdmin.account!.address])
    );

    await expect(
      BasicFeeHandlerInstance.write.renounceAdmin([newFeeHandlerAdmin.account!.address])
    );
    await expect(
      await BasicFeeHandlerInstance.read.hasRole([
        ADMIN_ROLE,
        newFeeHandlerAdmin.account!.address
      ])
    ).not.to.be.reverted;

    // check that former admin is no longer admin
    assert.isFalse(
      await BasicFeeHandlerInstance.read.hasRole([ADMIN_ROLE, feeHandlerAdmin.account!.address])
    );
  });
});
