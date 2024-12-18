// The Licensed Work is (c) 2022 Sygma
// SPDX-License-Identifier: LGPL-3.0-only

import hre from 'hardhat';
import {ContractTypesMap} from "hardhat/types";
import {Hex, WalletClient} from "viem";
import {deploySourceChainContracts} from "../../helpers";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {assert, expect} from 'chai';




describe("ERC721Handler - [Burn ERC721]", () => {
  const domainID = 1;
  const emptySetResourceData = "0x";

  let BridgeInstance: ContractTypesMap["Bridge"];
  let ERC721MintableInstance1: ContractTypesMap["ERC721MinterBurnerPauser"];;
  let ERC721MintableInstance2: ContractTypesMap["ERC721MinterBurnerPauser"];;
  let resourceID1: Hex;
  let resourceID2: Hex;
  let initialResourceIDs: Array<Hex>;
  let initialContractAddresses: Array<Hex>;
  let burnableContractAddresses: Array<Hex>;
  let mockBridge: WalletClient;

  beforeEach(async () => {
    ({
      BridgeInstance,
      ERC721MintableInstance: ERC721MintableInstance1,
      ERC721MintableInstance: ERC721MintableInstance2,
    } = await loadFixture(deploySourceChainContracts));
    [
      admin,
      depositor,
      mockBridge
    ] = await hre.viem.getWalletClients();

    resourceID1 = createResourceID(
      ERC721MintableInstance1.address,
      domainID
    );
    resourceID2 = createResourceID(
      ERC721MintableInstance2.address,
      domainID
    );
    initialResourceIDs = [resourceID1, resourceID2];
    initialContractAddresses = [
      ERC721MintableInstance1.address,
      ERC721MintableInstance2.address,
    ];
    burnableContractAddresses = [ERC721MintableInstance1.address];
  });

  it("burnableContractAddresses should be marked as burnable", async () => {
    const ERC721HandlerInstance = await hre.viem.deployContract("ERC721Handler", [mockBridge.account!.address]);

    for (let i = 0; i < initialResourceIDs.length; i++) {
      await expect(
        BridgeInstance.write.adminSetResource([
          ERC721HandlerInstance.address,
          initialResourceIDs[i],
          initialContractAddresses[i],
          emptySetResourceData
        ])
      ).not.to.be.reverted;
    }

    for (let i = 0; i < burnableContractAddresses.length; i++) {
      await expect(
        BridgeInstance.write.adminSetBurnable([
          ERC721HandlerInstance.address,
          burnableContractAddresses[i]
        ])
      ).not.to.be.reverted;
    }

    for (const burnableAddress of burnableContractAddresses) {
      const isBurnable = (await ERC721HandlerInstance.read._tokenContractAddressToTokenProperties([
        burnableAddress
      ]))

      assert.isTrue(isBurnable, "Contract wasn't successfully marked burnable");
    }
  });

  it("ERC721MintableInstance2.address should not be marked as burnable", async () => {
    const ERC721HandlerInstance = await hre.viem.deployContract("ERC721Handler", [mockBridge.account!.address]);

    for (let i = 0; i < initialResourceIDs.length; i++) {
      await expect(
        BridgeInstance.write.adminSetResource([
          ERC721HandlerInstance.address,
          initialResourceIDs[i],
          initialContractAddresses[i],
          emptySetResourceData
        ])
      ).not.to.be.reverted;
    }

    for (let i = 0; i < burnableContractAddresses.length; i++) {
      await expect(
        BridgeInstance.write.adminSetBurnable([
          ERC721HandlerInstance.address,
          burnableContractAddresses[i]
        ])
      ).not.to.be.reverted;
    }

    const isBurnable = (await ERC721HandlerInstance.read._tokenContractAddressToTokenProperties([
      ERC721MintableInstance2.address
    ]));

    assert.isFalse(isBurnable, "Contract shouldn't be marked burnable");
  });

  it("ERC721MintableInstance2.address should be marked as burnable after setBurnable is called", async () => {
    const ERC721HandlerInstance = await hre.viem.deployContract("ERC721Handler", [mockBridge.account!.address]);

    for (let i = 0; i < initialResourceIDs.length; i++) {
      await expect(
        BridgeInstance.write.adminSetResource([
          ERC721HandlerInstance.address,
          initialResourceIDs[i],
          initialContractAddresses[i],
          emptySetResourceData
        ])
      ).not.to.be.reverted;
    }

    for (let i = 0; i < burnableContractAddresses.length; i++) {
      await expect(
        BridgeInstance.write.adminSetBurnable([
          ERC721HandlerInstance.address,
          burnableContractAddresses[i]
        ])
      ).not.to.be.reverted;
    }

    await BridgeInstance.write.adminSetBurnable([
      ERC721HandlerInstance.address,
      ERC721MintableInstance2.address
    ]);
    const isBurnable = (await ERC721HandlerInstance.read._tokenContractAddressToTokenProperties([
      ERC721MintableInstance2.address
    ]));

    assert.isTrue(isBurnable, "Contract wasn't successfully marked burnable");
  });

  it(`ERC721MintableInstances should not be marked as
      burnable after setResource is called on already burnable tokens`, async () => {
        const ERC721HandlerInstance = await hre.viem.deployContract("ERC721Handler", [mockBridge.account!.address]);

    for (let i = 0; i < initialResourceIDs.length; i++) {
      await expect(
        BridgeInstance.write.adminSetResource([
          ERC721HandlerInstance.address,
          initialResourceIDs[i],
          initialContractAddresses[i],
          emptySetResourceData
        ])
      ).not.to.be.reverted;
    }

    for (let i = 0; i < initialResourceIDs.length; i++) {
      await expect(
        BridgeInstance.write.adminSetBurnable([
          ERC721HandlerInstance.address,
          initialContractAddresses[i]
        ])
      ).not.to.be.reverted;
    }

    // tokens should be marked as burnable
    for (let i = 0; i < initialResourceIDs.length; i++) {
      const isBurnableBeforeReRegisteringResource = (
        await ERC721HandlerInstance.read._tokenContractAddressToTokenProperties([
          initialContractAddresses[i]
        ])
      );

      assert.isTrue(isBurnableBeforeReRegisteringResource, "Contract wasn't successfully marked burnable");
    }

    // re-register resource - sets isBurnable to false for tokens
    for (let i = 0; i < initialResourceIDs.length; i++) {
      await expect(
        BridgeInstance.write.adminSetResource([
          ERC721HandlerInstance.address,
          initialResourceIDs[i],
          initialContractAddresses[i],
          emptySetResourceData
        ])
      ).not.to.be.reverted;
    }

    // tokens should not be marked as burnable if resource is re-registered
    for (let i = 0; i < initialResourceIDs.length; i++) {
      const isBurnableAfterReRegisteringResource = (
        await ERC721HandlerInstance.read._tokenContractAddressToTokenProperties([
          initialContractAddresses[i]
        ])
      );

      assert.isFalse(isBurnableAfterReRegisteringResource, "Contract shouldn't be marked burnable");
    }
  });
});
