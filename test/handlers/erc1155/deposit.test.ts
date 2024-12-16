// The Licensed Work is (c) 2022 Sygma
// SPDX-License-Identifier: LGPL-3.0-only

import hre from 'hardhat';
import {ContractTypesMap} from "hardhat/types";
import {createERC1155DepositData, createResourceID, deploySourceChainContracts, mpcAddress} from "../../helpers";
import {Hex, WalletClient} from "viem";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {assert, expect} from 'chai';



describe("ERC1155Handler - [Deposit ERC1155]", () => {
  const originDomainID = 1;
  const destinationDomainID = 2;
  const expectedDepositNonce = 1;

  const tokenID = BigInt(1);
  const tokenAmount = BigInt(100);
  const feeData = "0x";
  const emptySetResourceData = "0x";

  let BridgeInstance: ContractTypesMap["Bridge"];
  let ERC1155MintableInstance: ContractTypesMap["ERC1155PresetMinterPauser"];
  let ERC1155HandlerInstance: ContractTypesMap["ERC1155Handler"];

  let admin: WalletClient;
  let depositor: WalletClient;

  let resourceID: Hex;
  let depositData: Hex;

  before(async () => {
    ({
      BridgeInstance,
      ERC1155MintableInstance,
      ERC1155HandlerInstance
    } = await loadFixture(deploySourceChainContracts));
    [
      admin,
      depositor,
    ] = await hre.viem.getWalletClients();

    resourceID = createResourceID(
      ERC1155MintableInstance.address,
      originDomainID
    );

    await ERC1155MintableInstance.write.mintBatch([
      depositor.account!.address,
      [tokenID],
      [tokenAmount],
      "0x0"
    ]);

    await ERC1155MintableInstance.write.setApprovalForAll([
      ERC1155HandlerInstance.address,
      true
    ],
      {
        account: depositor.account
      }
    );
    await BridgeInstance.write.adminSetResource([
      ERC1155HandlerInstance.address,
      resourceID,
      ERC1155MintableInstance.address,
      emptySetResourceData
    ]);

    depositData = createERC1155DepositData([tokenID], [tokenAmount]);

    // set MPC address to unpause the Bridge
    await BridgeInstance.write.endKeygen([mpcAddress]);
  });

  it("[sanity] depositor owns tokenAmount of tokenID", async () => {
    const depositorBalance = await ERC1155MintableInstance.read.balanceOf([
      depositor.account!.address,
      tokenID
    ]);
    assert.equal(tokenAmount, depositorBalance);
  });

  it("Deposit event is emitted with expected values", async () => {
    const depositTx = await BridgeInstance.write.deposit([
      destinationDomainID,
      resourceID,
      depositData,
      feeData
    ],
      {
        account: depositor.account
      }
    );

    await expect(depositTx).to.emit(BridgeInstance, "Deposit").withArgs(
      destinationDomainID,
      resourceID.toLowerCase(),
      expectedDepositNonce,
      depositData,
      null,
    );
  });
});
