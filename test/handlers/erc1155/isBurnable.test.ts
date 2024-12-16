// The Licensed Work is (c) 2022 Sygma
// SPDX-License-Identifier: LGPL-3.0-only

import hre from 'hardhat';
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {deploySourceChainContracts} from "../../helpers";
import {Hex, WalletClient} from "viem";
import {ContractTypesMap} from "hardhat/types";
import {assert, expect} from 'chai';



describe("ERC1155Handler - [Burn ERC1155]", () => {
  const domainID = 1;
  const emptySetResourceData = "0x";

  let BridgeInstance: ContractTypesMap["Bridge"];
  let ERC1155MintableInstance1: ContractTypesMap["ERC1155PresetMinterPauser"];;
  let ERC1155MintableInstance2: ContractTypesMap["ERC1155PresetMinterPauser"];;
  let resourceID1: Hex;
  let resourceID2: Hex;
  let initialResourceIDs: Array<Hex>;
  let initialContractAddresses: Array<Hex>;
  let burnableContractAddresses: Array<Hex>;
  let mockBridge: WalletClient;

  before(async () => {
    ({
      BridgeInstance,
      ERC1155MintableInstance: ERC1155MintableInstance1,
      ERC1155MintableInstance: ERC1155MintableInstance2,
    } = await loadFixture(deploySourceChainContracts));
    [
      admin,
      depositor,
      mockBridge
    ] = await hre.viem.getWalletClients();

    resourceID1 = createResourceID(
      ERC1155MintableInstance1.address,
      domainID
    );
    resourceID2 = createResourceID(
      ERC1155MintableInstance2.address,
      domainID
    );
    initialResourceIDs = [resourceID1, resourceID2];
    initialContractAddresses = [
      ERC1155MintableInstance1.address,
      ERC1155MintableInstance2.address,
    ];
    burnableContractAddresses = [ERC1155MintableInstance1.address];
  });

  it("burnableContractAddresses should be marked as burnable", async () => {
    const ERC1155HandlerInstance = await hre.viem.deployContract("ERC1155Handler", [mockBridge.account!.address]);

    for (let i = 0; i < initialResourceIDs.length; i++) {
      await expect(
        BridgeInstance.write.adminSetResource([
          ERC1155HandlerInstance.address,
          initialResourceIDs[i],
          initialContractAddresses[i],
          emptySetResourceData
        ])
      ).not.to.be.reverted;
    }

    for (let i = 0; i < burnableContractAddresses.length; i++) {
      await expect(
        BridgeInstance.write.adminSetBurnable([
          ERC1155HandlerInstance.address,
          burnableContractAddresses[i]
        ])
      ).not.to.be.reverted;
    }

    for (const burnableAddress of burnableContractAddresses) {
      const isBurnable = (await ERC1155HandlerInstance.read._tokenContractAddressToTokenProperties([
        burnableAddress
      ]));

      assert.isTrue(isBurnable, "Contract wasn't successfully marked burnable");
    }
  });

  it("ERC1155MintableInstance2.address should not be marked as burnable", async () => {
    const ERC1155HandlerInstance = await hre.viem.deployContract("ERC1155Handler", [mockBridge.account!.address]);

    for (let i = 0; i < initialResourceIDs.length; i++) {
      await expect(
        BridgeInstance.write.adminSetResource([
          ERC1155HandlerInstance.address,
          initialResourceIDs[i],
          initialContractAddresses[i],
          emptySetResourceData
        ])
      ).not.to.be.reverted;
    }

    for (let i = 0; i < burnableContractAddresses.length; i++) {
      await expect(
        BridgeInstance.write.adminSetBurnable([
          ERC1155HandlerInstance.address,
          burnableContractAddresses[i]
        ])
      ).not.to.be.reverted;
    }

    const isBurnable = (await ERC1155HandlerInstance.read._tokenContractAddressToTokenProperties([
      ERC1155MintableInstance2.address
    ]));

    assert.isFalse(isBurnable, "Contract shouldn't be marked burnable");
  });

  it("ERC1155MintableInstance2.address should be marked as burnable after setBurnable is called", async () => {
    const ERC1155HandlerInstance = await hre.viem.deployContract("ERC1155Handler", [mockBridge.account!.address]);

    for (let i = 0; i < initialResourceIDs.length; i++) {
      await expect(
        BridgeInstance.write.adminSetResource([
          ERC1155HandlerInstance.address,
          initialResourceIDs[i],
          initialContractAddresses[i],
          emptySetResourceData
        ])
      ).not.to.be.reverted;
    }

    for (let i = 0; i < burnableContractAddresses.length; i++) {
      await expect(
        BridgeInstance.write.adminSetBurnable([
          ERC1155HandlerInstance.address,
          burnableContractAddresses[i]
        ])
      ).not.to.be.reverted;
    }

    await BridgeInstance.write.adminSetBurnable([
      ERC1155HandlerInstance.address,
      ERC1155MintableInstance2.address
    ]);
    const isBurnable = (await ERC1155HandlerInstance.read._tokenContractAddressToTokenProperties([
      ERC1155MintableInstance2.address
    ]));

    assert.isTrue(isBurnable, "Contract wasn't successfully marked burnable");
  });

  it(`ERC1155MintableInstances should not be marked as
      burnable after setResource is called on already burnable tokens`, async () => {
    const ERC1155HandlerInstance = await hre.viem.deployContract("ERC1155Handler", [mockBridge.account!.address]);

    for (let i = 0; i < initialResourceIDs.length; i++) {
      await expect(
        BridgeInstance.write.adminSetResource([
          ERC1155HandlerInstance.address,
          initialResourceIDs[i],
          initialContractAddresses[i],
          emptySetResourceData
        ])
      ).not.to.be.reverted;
    }

    for (let i = 0; i < initialResourceIDs.length; i++) {
      await expect(
        BridgeInstance.write.adminSetBurnable([
          ERC1155HandlerInstance.address,
          initialContractAddresses[i]
        ])
      ).not.to.be.reverted;
    }

    // tokens should be marked as burnable
    for (let i = 0; i < initialResourceIDs.length; i++) {
      const isBurnableBeforeReRegisteringResource = (
        await ERC1155HandlerInstance.read._tokenContractAddressToTokenProperties([
          initialContractAddresses[i]
        ])
      );

      assert.isTrue(isBurnableBeforeReRegisteringResource, "Contract wasn't successfully marked burnable");
    }

    // re-register resource - sets isBurnable to false for tokens
    for (let i = 0; i < initialResourceIDs.length; i++) {
      await expect(
        BridgeInstance.write.adminSetResource([
          ERC1155HandlerInstance.address,
          initialResourceIDs[i],
          initialContractAddresses[i],
          emptySetResourceData
        ])
      ).not.to.be.reverted;
    }

    // tokens should not be marked as burnable if resource is re-registered
    for (let i = 0; i < initialResourceIDs.length; i++) {
      const isBurnableAfterReRegisteringResource = (
        await ERC1155HandlerInstance.read._tokenContractAddressToTokenProperties([
          initialContractAddresses[i]
        ])
      );

      assert.isFalse(isBurnableAfterReRegisteringResource, "Contract shouldn't be marked burnable");
    }
  });
});
