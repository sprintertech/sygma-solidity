// The Licensed Work is (c) 2022 Sygma
// SPDX-License-Identifier: LGPL-3.0-only

import hre from 'hardhat';
import {WalletClient} from "viem";
import {ContractTypesMap} from "hardhat/types";
import {createResourceID, deploySourceChainContracts} from "../../helpers";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {Hex} from "viem";
import {assert, expect} from "chai";

describe("XC20Handler - [Burn XC20]", () => {
  const domainID = 1;
  const emptySetResourceData = "0x";

  let BridgeInstance: ContractTypesMap["Bridge"];
  let ERC20MintableInstance1: ContractTypesMap["ERC20PresetMinterPauser"];
  let ERC20MintableInstance2: ContractTypesMap["ERC20PresetMinterPauser"];
  let XC20HandlerInstance: ContractTypesMap["XC20Handler"];
  let resourceID1: Hex;
  let resourceID2: Hex;
  let initialResourceIDs: Array<Hex>;
  let initialContractAddresses: Array<Hex>;
  let burnableContractAddresses: Array<Hex>;

  let mockBridge: WalletClient;

  before(async () => {
    ({
      BridgeInstance,
      XC20HandlerInstance,
    } = await loadFixture(deploySourceChainContracts));
    [
      ,
      mockBridge,
    ] = await hre.viem.getWalletClients();

    resourceID1 = createResourceID(
      ERC20MintableInstance1.address,
      domainID
    );
    resourceID2 = createResourceID(
      ERC20MintableInstance2.address,
      domainID
    );
    initialResourceIDs = [resourceID1, resourceID2];
    initialContractAddresses = [
      ERC20MintableInstance1.address,
      ERC20MintableInstance2.address,
    ];
    burnableContractAddresses = [ERC20MintableInstance1.address];
  });

  it("burnableContractAddresses should be marked as burnable", async () => {
    for (let i = 0; i < initialResourceIDs.length; i++) {
      await expect(
        BridgeInstance.write.adminSetResource([
          XC20HandlerInstance.address,
          initialResourceIDs[i],
          initialContractAddresses[i],
          emptySetResourceData
        ])
      ).not.to.be.reverted;
    }

    for (let i = 0; i < burnableContractAddresses.length; i++) {
      await expect(
        BridgeInstance.write.adminSetBurnable([
          XC20HandlerInstance.address,
          burnableContractAddresses[i]
        ])
      ).not.to.be.reverted;
    }

    for (const burnableAddress of burnableContractAddresses) {
      const isBurnable = (await XC20HandlerInstance.read._tokenContractAddressToTokenProperties([
        burnableAddress
      ]));

      assert.isTrue(isBurnable, "Contract wasn't successfully marked burnable");
    }
  });

  it("ERC20MintableInstance2.address should not be marked as burnable", async () => {
    for (let i = 0; i < initialResourceIDs.length; i++) {
      await expect(
        BridgeInstance.write.adminSetResource([
          XC20HandlerInstance.address,
          initialResourceIDs[i],
          initialContractAddresses[i],
          emptySetResourceData
        ])
      ).not.to.be.reverted;
    }

    for (let i = 0; i < burnableContractAddresses.length; i++) {
      await expect(
        BridgeInstance.write.adminSetBurnable([
          XC20HandlerInstance.address,
          burnableContractAddresses[i]
        ])
      ).not.to.be.reverted;
    }

    const isBurnable = (await XC20HandlerInstance.read._tokenContractAddressToTokenProperties([
      ERC20MintableInstance2.address
    ]));

    assert.isFalse(isBurnable, "Contract shouldn't be marked burnable");
  });

  it("ERC20MintableInstance2.address should be marked as burnable after setBurnable is called", async () => {
    const XC20HandlerInstance = await hre.viem.deployContract("XC20Handler", [mockBridge.account!.address]);


    for (let i = 0; i < initialResourceIDs.length; i++) {
      await expect(
        BridgeInstance.write.adminSetResource([
          XC20HandlerInstance.address,
          initialResourceIDs[i],
          initialContractAddresses[i],
          emptySetResourceData
        ])
      ).not.to.be.reverted;
    }

    for (let i = 0; i < burnableContractAddresses.length; i++) {
      await expect(
        BridgeInstance.write.adminSetBurnable([
          XC20HandlerInstance.address,
          burnableContractAddresses[i]
        ])
      ).not.to.be.reverted;
    }

    await BridgeInstance.write.adminSetBurnable([
      XC20HandlerInstance.address,
      ERC20MintableInstance2.address
    ]);
    const isBurnable = (await XC20HandlerInstance.read._tokenContractAddressToTokenProperties([
      ERC20MintableInstance2.address
    ]));

    assert.isTrue(isBurnable, "Contract wasn't successfully marked burnable");
  });

  it(`XC20MintableInstances should not be marked as
      burnable after setResource is called on already burnable tokens`, async () => {
    for (let i = 0; i < initialResourceIDs.length; i++) {
      await expect(
        BridgeInstance.write.adminSetResource([
          XC20HandlerInstance.address,
          initialResourceIDs[i],
          initialContractAddresses[i],
          emptySetResourceData
        ])
      ).not.to.be.reverted;
    }

    for (let i = 0; i < initialResourceIDs.length; i++) {
      await expect(
        BridgeInstance.write.adminSetBurnable([
          XC20HandlerInstance.address,
          initialContractAddresses[i]
        ])
      ).not.to.be.reverted;
    }

    // tokens should be marked as burnable
    for (let i = 0; i < initialResourceIDs.length; i++) {
      const isBurnableBeforeReRegisteringResource = (
        await XC20HandlerInstance._tokenContractAddressToTokenProperties.call(
          initialContractAddresses[i]
        )
      ).isBurnable;

      assert.isTrue(isBurnableBeforeReRegisteringResource, "Contract wasn't successfully marked burnable");
    }

    // re-register resource - sets isBurnable to false for tokens
    for (let i = 0; i < initialResourceIDs.length; i++) {
      await expect(
        BridgeInstance.write.adminSetResource([
          XC20HandlerInstance.address,
          initialResourceIDs[i],
          initialContractAddresses[i],
          emptySetResourceData
        ])
      ).not.to.be.reverted;
    }

    // tokens should not be marked as burnable if resource is re-registered
    for (let i = 0; i < initialResourceIDs.length; i++) {
      const isBurnableAfterReRegisteringResource = (
        await XC20HandlerInstance._tokenContractAddressToTokenProperties.call(
          initialContractAddresses[i]
        )
      ).isBurnable;

      assert.isFalse(isBurnableAfterReRegisteringResource, "Contract shouldn't be marked burnable");
    }
  });
});
