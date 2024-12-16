// The Licensed Work is (c) 2022 Sygma
// SPDX-License-Identifier: LGPL-3.0-only


import hre from 'hardhat';
import {WalletClient} from "viem";
import {ContractTypesMap} from "hardhat/types";
import {createResourceID, deploySourceChainContracts} from "../../helpers";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {Hex} from "viem";
import {assert, expect} from "chai";

describe("XC20Handler - [setResourceIDAndContractAddress]", () => {
    const domainID = 1;
    const emptySetResourceData = "0x";

    let BridgeInstance: ContractTypesMap["Bridge"];
    let ERC20MintableInstance1: ContractTypesMap["ERC20PresetMinterPauser"];
    let ERC20MintableInstance2: ContractTypesMap["ERC20PresetMinterPauser"];
    let XC20HandlerInstance1: ContractTypesMap["XC20Handler"];
    let XC20HandlerInstance2: ContractTypesMap["XC20Handler"];

    let resourceID: Hex;

    before(async () => {
      ({
        BridgeInstance,
        XC20HandlerInstance: XC20HandlerInstance1,
        XC20HandlerInstance: XC20HandlerInstance2,
      } = await loadFixture(deploySourceChainContracts));

      resourceID = createResourceID(
        ERC20MintableInstance1.address,
        domainID
      );

      await BridgeInstance.write.adminSetResource([
        XC20HandlerInstance1.address,
        resourceID,
        ERC20MintableInstance1.address,
        emptySetResourceData
      ]);
    });

    it("[sanity] ERC20MintableInstance1's resourceID and contract address should be set correctly", async () => {
      const retrievedTokenAddress =
        await XC20HandlerInstance1.read._resourceIDToTokenContractAddress([
          resourceID
        ]);
      assert.strictEqual(
        ERC20MintableInstance1.address,
        retrievedTokenAddress
      );

      const retrievedResourceID = (await XC20HandlerInstance1.read._tokenContractAddressToTokenProperties([
        ERC20MintableInstance1.address
      ]))[0]

      assert.strictEqual(
        resourceID.toLowerCase(),
        retrievedResourceID.toLowerCase()
      );
    });

    it("new resourceID and corresponding contract address should be set correctly", async () => {
      const secondERC20ResourceID = createResourceID(
        ERC20MintableInstance2.address,
        domainID
      );

      await BridgeInstance.write.adminSetResource([
        XC20HandlerInstance1.address,
        secondERC20ResourceID,
        ERC20MintableInstance2.address,
        emptySetResourceData
      ]);

      const retrievedTokenAddress =
        await XC20HandlerInstance1.read._resourceIDToTokenContractAddress([
          secondERC20ResourceID
        ]);
      assert.strictEqual(
        ERC20MintableInstance2.address,
        retrievedTokenAddress
      );

      const retrievedResourceID = (await XC20HandlerInstance1.read._tokenContractAddressToTokenProperties([
        ERC20MintableInstance2.address
      ]))[0];

      assert.strictEqual(
        secondERC20ResourceID.toLowerCase(),
        retrievedResourceID.toLowerCase()
      );
    });

    it("existing resourceID should be updated correctly with new token contract address", async () => {
      await BridgeInstance.write.adminSetResource([
        XC20HandlerInstance1.address,
        resourceID,
        ERC20MintableInstance1.address,
        emptySetResourceData
      ]);

      await BridgeInstance.write.adminSetResource([
        XC20HandlerInstance1.address,
        resourceID,
        ERC20MintableInstance2.address,
        emptySetResourceData
      ]);

      const retrievedTokenAddress =
        await XC20HandlerInstance1.read._resourceIDToTokenContractAddress([
          resourceID
        ]);
      assert.strictEqual(ERC20MintableInstance2.address, retrievedTokenAddress);

      const retrievedResourceID = (await XC20HandlerInstance1.read._tokenContractAddressToTokenProperties([
        ERC20MintableInstance2.address
      ]))[0];

      assert.strictEqual(
        resourceID.toLowerCase(),
        retrievedResourceID.toLowerCase()
      );
    });

    it("existing resourceID should be updated correctly with new handler address", async () => {
      await BridgeInstance.write.adminSetResource([
        XC20HandlerInstance1.address,
        resourceID,
        ERC20MintableInstance1.address,
        emptySetResourceData
      ]);

      await BridgeInstance.write.adminSetResource([
        XC20HandlerInstance2.address,
        resourceID,
        ERC20MintableInstance2.address,
        emptySetResourceData
      ]);

      const bridgeHandlerAddress =
        await BridgeInstance.read._resourceIDToHandlerAddress([
          resourceID
        ]);
      assert.strictEqual(
        bridgeHandlerAddress.toLowerCase(),
        XC20HandlerInstance2.address.toLowerCase()
      );
    });

    it("existing resourceID should be replaced by new resourceID in handler", async () => {
      await BridgeInstance.write.adminSetResource([
        XC20HandlerInstance1.address,
        resourceID,
        ERC20MintableInstance1.address,
        emptySetResourceData
      ]);

      const secondERC20ResourceID = createResourceID(
        ERC20MintableInstance2.address,
        domainID
      );

      await BridgeInstance.write.adminSetResource([
        XC20HandlerInstance1.address,
        secondERC20ResourceID,
        ERC20MintableInstance1.address,
        emptySetResourceData
      ]);

      const retrievedResourceID = (await XC20HandlerInstance1.read._tokenContractAddressToTokenProperties([
        ERC20MintableInstance1.address
      ]))[0];

      assert.strictEqual(
        secondERC20ResourceID.toLowerCase(),
        retrievedResourceID.toLowerCase()
      );

      const retrievedContractAddress =
        await XC20HandlerInstance1.read._resourceIDToTokenContractAddress([
          secondERC20ResourceID
        ]);
      assert.strictEqual(
        retrievedContractAddress.toLowerCase(),
        ERC20MintableInstance1.address.toLowerCase()
      );
    });
  }
);
