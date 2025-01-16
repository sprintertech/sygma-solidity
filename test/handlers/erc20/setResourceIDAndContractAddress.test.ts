// The Licensed Work is (c) 2022 Sygma
// SPDX-License-Identifier: LGPL-3.0-only

import hre from 'hardhat';
import {ContractTypesMap} from "hardhat/types";
import {createResourceID, deploySourceChainContracts} from "../../helpers";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {Hex, WalletClient} from 'viem';
import {assert} from 'chai';



describe("ERC20Handler - [setResourceIDAndContractAddress]", () => {
    const domainID = 1;
    const emptySetResourceData = "0x";

    let BridgeInstance: ContractTypesMap["Bridge"];
    let ERC20MintableInstance1: ContractTypesMap["ERC20PresetMinterPauser"];
    let DefaultMessageReceiverInstance: ContractTypesMap["DefaultMessageReceiver"];
    let ERC20HandlerInstance: ContractTypesMap["ERC20Handler"];
    let mockBridge: WalletClient;

    let resourceID1: Hex;

    beforeEach(async () => {
      ({
        DefaultMessageReceiverInstance,
        BridgeInstance,
        ERC20HandlerInstance,
        ERC20MintableInstance: ERC20MintableInstance1,
      } = await loadFixture(deploySourceChainContracts));
      [
        admin,
        depositor,
        mockBridge,
        relayer1
      ] = await hre.viem.getWalletClients();

      resourceID1 = createResourceID(
          ERC20MintableInstance1.address,
          domainID
        );

      await BridgeInstance.write.adminSetResource([
        ERC20HandlerInstance.address,
        resourceID1,
        ERC20MintableInstance1.address,
        emptySetResourceData
      ]);
    });

    it("[sanity] ERC20MintableInstance1's resourceID and contract address should be set correctly", async () => {
      const retrievedTokenAddress =
        await ERC20HandlerInstance.read._resourceIDToTokenContractAddress([
          resourceID1
        ]);
      assert.strictEqual(
        ERC20MintableInstance1.address,
        retrievedTokenAddress
      );

      const retrievedResourceID = (await ERC20HandlerInstance.read._tokenContractAddressToTokenProperties([
        ERC20MintableInstance1.address
      ]))[0]

      assert.strictEqual(
        resourceID1.toLowerCase(),
        retrievedResourceID.toLowerCase()
      );
    });

    it("new resourceID and corresponding contract address should be set correctly", async () => {
      const ERC20MintableInstance2 = await hre.viem.deployContract("ERC20PresetMinterPauser", ["Token", "TOK"]);

      const resourceID2 = createResourceID(
        ERC20MintableInstance2.address,
        domainID
      );

      await BridgeInstance.write.adminSetResource([
        ERC20HandlerInstance.address,
        resourceID2,
        ERC20MintableInstance2.address,
        emptySetResourceData
      ]);

      const retrievedTokenAddress =
        await ERC20HandlerInstance.read._resourceIDToTokenContractAddress([
          resourceID2
      ]);
      assert.strictEqual(
        ERC20MintableInstance2.address,
        retrievedTokenAddress
      );

      const retrievedResourceID = (await ERC20HandlerInstance.read._tokenContractAddressToTokenProperties([
        ERC20MintableInstance2.address
      ]))[0]

      assert.strictEqual(
        resourceID2.toLowerCase(),
        retrievedResourceID.toLowerCase()
      );
    });

    it("existing resourceID should be updated correctly with new token contract address", async () => {
      await BridgeInstance.write.adminSetResource([
        ERC20HandlerInstance.address,
        resourceID1,
        ERC20MintableInstance1.address,
        emptySetResourceData
      ]);

      const ERC20MintableInstance2 = await hre.viem.deployContract("ERC20PresetMinterPauser", ["Token", "TOK"]);

      await BridgeInstance.write.adminSetResource([
        ERC20HandlerInstance.address,
        resourceID1,
        ERC20MintableInstance2.address,
        emptySetResourceData
      ]);

      const retrievedTokenAddress =
        await ERC20HandlerInstance.read._resourceIDToTokenContractAddress([
          resourceID1
        ]);
      assert.strictEqual(ERC20MintableInstance2.address, retrievedTokenAddress);

      const retrievedResourceID = (await ERC20HandlerInstance.read._tokenContractAddressToTokenProperties([
        ERC20MintableInstance2.address
      ]))[0]

      assert.strictEqual(
        resourceID1.toLowerCase(),
        retrievedResourceID.toLowerCase()
      );
    });

    it("existing resourceID should be updated correctly with new handler address", async () => {
      await BridgeInstance.write.adminSetResource([
        ERC20HandlerInstance.address,
        resourceID1,
        ERC20MintableInstance1.address,
        emptySetResourceData
      ]);

      const ERC20MintableInstance2 = await hre.viem.deployContract("ERC20PresetMinterPauser", ["Token", "TOK"]);
      const ERC20HandlerInstance2 = await hre.viem.deployContract("ERC20Handler", [mockBridge.account!.address, DefaultMessageReceiverInstance.address]);

      await BridgeInstance.write.adminSetResource([
        ERC20HandlerInstance2.address,
        resourceID1,
        ERC20MintableInstance2.address,
        emptySetResourceData
      ]);

      const bridgeHandlerAddress =
        await BridgeInstance.read._resourceIDToHandlerAddress([
          resourceID1
      ]);
      assert.strictEqual(
        bridgeHandlerAddress.toLowerCase(),
        ERC20HandlerInstance2.address.toLowerCase()
      );
    });

    it("existing resourceID should be replaced by new resourceID in handler", async () => {
      await BridgeInstance.write.adminSetResource([
        ERC20HandlerInstance.address,
        resourceID1,
        ERC20MintableInstance1.address,
        emptySetResourceData
      ]);

      const ERC20MintableInstance2 = await hre.viem.deployContract("ERC20PresetMinterPauser", ["Token", "TOK"]);

      const resourceID2 = createResourceID(
        ERC20MintableInstance2.address,
        domainID
      );

      await BridgeInstance.write.adminSetResource([
        ERC20HandlerInstance.address,
        resourceID2,
        ERC20MintableInstance1.address,
        emptySetResourceData
      ]);

      const retrievedResourceID = (await ERC20HandlerInstance.read._tokenContractAddressToTokenProperties([
        ERC20MintableInstance1.address
      ]))[0];

      assert.strictEqual(
        resourceID2.toLowerCase(),
        retrievedResourceID.toLowerCase()
      );

      const retrievedContractAddress =
        await ERC20HandlerInstance.read._resourceIDToTokenContractAddress([
          resourceID2
      ]);

      assert.strictEqual(
        retrievedContractAddress.toLowerCase(),
        ERC20MintableInstance1.address.toLowerCase()
      );
    });
  }
);
