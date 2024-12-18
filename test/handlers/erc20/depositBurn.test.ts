// The Licensed Work is (c) 2022 Sygma
// SPDX-License-Identifier: LGPL-3.0-only

import hre from 'hardhat';
import {ContractTypesMap} from "hardhat/types";
import {createERCDepositData, createResourceID, deploySourceChainContracts, mpcAddress} from "../../helpers";
import {Hex, WalletClient} from "viem";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {assert} from 'chai';

describe("ERC20Handler - [Deposit Burn ERC20]", () => {
  const domainID = 1;
  const depositAmount = BigInt(10);
  const emptySetResourceData = "0x";

  let BridgeInstance: ContractTypesMap["Bridge"];
  let ERC20MintableInstance1: ContractTypesMap["ERC20PresetMinterPauser"];
  let ERC20MintableInstance2: ContractTypesMap["ERC20PresetMinterPauser"];
  let ERC20HandlerInstance: ContractTypesMap["ERC20Handler"];

  let recipient: WalletClient;
  let depositor: WalletClient;

  let resourceID1: Hex;
  let resourceID2: Hex;
  let depositData: Hex;
  let initialResourceIDs: Array<Hex>;
  let initialContractAddresses: Array<Hex>;
  let burnableContractAddresses: Array<Hex>;

  beforeEach(async () => {
    ({
      BridgeInstance,
      ERC20HandlerInstance,
      ERC20MintableInstance: ERC20MintableInstance1,
      ERC20MintableInstance: ERC20MintableInstance2,
    } = await loadFixture(deploySourceChainContracts));
    [
      ,
      depositor,
      recipient,
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

    await ERC20MintableInstance1.write.approve([
        ERC20HandlerInstance.address,
        depositAmount
      ],
        {
          account: depositor.account
        }
      ),
      await BridgeInstance.write.adminSetResource([
        ERC20HandlerInstance.address,
        resourceID1,
        ERC20MintableInstance1.address,
        emptySetResourceData
      ]);
      await BridgeInstance.write.adminSetResource([
        ERC20HandlerInstance.address,
        resourceID2,
        ERC20MintableInstance2.address,
        emptySetResourceData
      ]);
      await BridgeInstance.write.adminSetBurnable([
        ERC20HandlerInstance.address,
        ERC20MintableInstance1.address
      ]);

    depositData = createERCDepositData(
      depositAmount,
      20,
      recipient.account!.address
    );

    // set MPC address to unpause the Bridge
    await BridgeInstance.write.endKeygen([mpcAddress]);
  });

  it("[sanity] burnableContractAddresses should be marked as burnable", async () => {
    for (const burnableAddress of burnableContractAddresses) {
      const isBurnable = (await ERC20HandlerInstance.read._tokenContractAddressToTokenProperties([
        burnableAddress
      ]))[0]

      assert.isTrue(isBurnable, "Contract wasn't successfully marked burnable");
    }
  });
});
