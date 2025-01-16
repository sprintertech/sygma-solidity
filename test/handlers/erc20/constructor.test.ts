// The Licensed Work is (c) 2022 Sygma
// SPDX-License-Identifier: LGPL-3.0-only

import hre from 'hardhat';
import {ContractTypesMap} from "hardhat/types";
import {Hex, toHex, WalletClient} from "viem";
import {createResourceID, deploySourceChainContracts} from "../../helpers";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {assert, expect} from 'chai';


describe("ERC20Handler - [constructor]", async () => {
  const domainID = 1;
  const emptySetResourceData = "0x";

  let BridgeInstance: ContractTypesMap["Bridge"];
  let DefaultMessageReceiverInstance: ContractTypesMap["DefaultMessageReceiver"];
  let ERC20MintableInstance1: ContractTypesMap["ERC20PresetMinterPauser"];
  let ERC20MintableInstance2: ContractTypesMap["ERC20PresetMinterPauser"];;
  let ERC20MintableInstance3: ContractTypesMap["ERC20PresetMinterPauser"];;
  let initialResourceIDs: Array<Hex>;
  let initialContractAddresses: Array<Hex>;
  let mockBridge: WalletClient;
  let mockDefaultMessageReceiver: WalletClient;

  beforeEach(async () => {
    ({
      DefaultMessageReceiverInstance,
      BridgeInstance,
      ERC20MintableInstance: ERC20MintableInstance1,
      ERC20MintableInstance: ERC20MintableInstance2,
      ERC20MintableInstance: ERC20MintableInstance3,
    } = await loadFixture(deploySourceChainContracts));
    [
      ,
      mockBridge,
      mockDefaultMessageReceiver,
    ] = await hre.viem.getWalletClients();

    initialResourceIDs.push(
      createResourceID(
        ERC20MintableInstance1.address,
        domainID
      )
    );
    initialResourceIDs.push(
      createResourceID(
        ERC20MintableInstance2.address,
        domainID
      )
    );
    initialResourceIDs.push(
      createResourceID(
        ERC20MintableInstance3.address,
        domainID
      )
    );

    initialContractAddresses = [
      ERC20MintableInstance1.address,
      ERC20MintableInstance2.address,
      ERC20MintableInstance3.address,
    ];
  });

  it("[sanity] bridge configured on domain", async () => {
    assert.equal(await BridgeInstance.read._domainID(), domainID);
  });

  it("[sanity] bridge should be initially paused", async () => {
    assert.isTrue(await BridgeInstance.read.paused());
  });

  it(`initialResourceIDs should be parsed correctly and
      corresponding resourceID mappings should have expected values`, async () => {
    const ERC20HandlerInstance = await hre.viem.deployContract("ERC20Handler", [BridgeInstance.address, DefaultMessageReceiverInstance.address]);

    for (let i = 0; i < initialResourceIDs.length; i++) {
      await expect(
        BridgeInstance.write.adminSetResource([
          ERC20HandlerInstance.address,
          initialResourceIDs[i],
          initialContractAddresses[i],
          emptySetResourceData
        ])
      ).not.to.be.reverted;
    }

    for (const resourceID of initialResourceIDs) {
      const tokenAddress = toHex(resourceID.substring(24, 40), {size: 20});

      const retrievedTokenAddress =
        await ERC20HandlerInstance.read._resourceIDToTokenContractAddress([
          resourceID
        ]);
      assert.strictEqual(
        tokenAddress,
        retrievedTokenAddress
      );

      const retrievedResourceID = (await ERC20HandlerInstance.read._tokenContractAddressToTokenProperties([
        tokenAddress
      ]))[0];

      assert.strictEqual(
        resourceID.toLowerCase(),
        retrievedResourceID.toLowerCase()
      );
    }
  });
});
