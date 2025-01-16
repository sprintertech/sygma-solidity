// The Licensed Work is (c) 2022 Sygma
// SPDX-License-Identifier: LGPL-3.0-only

import hre from 'hardhat';
import {concat, Hex, keccak256, WalletClient} from "viem";
import {createERCDepositData, createResourceID, deploySourceChainContracts, mpcAddress, trimPrefix} from "../../helpers";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {ContractTypesMap} from "hardhat/types";
import {assert, expect} from 'chai';


describe("ERC20Handler - [Deposit ERC20]", async () => {
  const originDomainID = 1;
  const destinationDomainID = 2;
  const expectedDepositNonce = 1;

  const tokenAmount = BigInt(100);
  const feeData = "0x";
  const emptySetResourceData = "0x";
  const lenrecipient = 40;

  let BridgeInstance: ContractTypesMap["Bridge"];
  let ERC20MintableInstance: ContractTypesMap["ERC20PresetMinterPauser"];
  let ERC20HandlerInstance: ContractTypesMap["ERC20Handler"];

  let admin: WalletClient;
  let depositor: WalletClient;
  let recipient: WalletClient;
  let EOA_Address: WalletClient;

  let resourceID: Hex;
  let depositData: Hex;

  beforeEach(async () => {
    ({
      BridgeInstance,
      ERC20HandlerInstance,
      ERC20MintableInstance,
    } = await loadFixture(deploySourceChainContracts));
    [
      admin,
      depositor,
      recipient,
      EOA_Address
    ] = await hre.viem.getWalletClients();

    resourceID = createResourceID(
      ERC20MintableInstance.address,
      originDomainID
    );

    depositData = createERCDepositData(
      tokenAmount,
      lenrecipient,
      concat([admin.account!.address, trimPrefix(recipient.account!.address)])
    );

    await ERC20MintableInstance.write.mint([depositor.account!.address, tokenAmount]);

    await ERC20MintableInstance.write.approve([
      ERC20HandlerInstance.address,
      tokenAmount
    ], {
        account: depositor.account,
      }
    );
    await BridgeInstance.write.adminSetResource([
        ERC20HandlerInstance.address,
        resourceID,
        ERC20MintableInstance.address,
        emptySetResourceData
    ]);

    // set MPC address to unpause the Bridge
    await BridgeInstance.write.endKeygen([mpcAddress]);
  });

  it("[sanity] depositor owns tokenAmount of ERC20", async () => {
    const depositorBalance = await ERC20MintableInstance.read.balanceOf([
      depositor.account!.address
    ]);
    assert.equal(tokenAmount, depositorBalance);
  });

  it("[sanity] ERC20HandlerInstance.address has an allowance of tokenAmount from depositor", async () => {
    const handlerAllowance = await ERC20MintableInstance.read.allowance([
      depositor.account!.address,
      ERC20HandlerInstance.address
    ]);
    assert.equal(tokenAmount, handlerAllowance);
  });

  it("Varied recipient address with length 40", async () => {
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
      depositor,
      depositData,
      null
    );
  });

  it("Varied recipient address with length 32", async () => {
    const recipient = keccak256(admin.account!.address);
    const lenrecipient = 32;
    const depositData = createERCDepositData(
      tokenAmount,
      lenrecipient,
      recipient
    );

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
      depositor,
      depositData,
      null
    );
  });

  it(`When non-contract addresses are whitelisted in the handler,
      deposits which the addresses are set as a token address will be failed`, async () => {
    const NonContract_Address = "0x0000000000000000000000000000000000001111";
    const resourceID_NonContract_Address = createResourceID(
      NonContract_Address,
      originDomainID
    );
    const resourceID_EOA_Address = createResourceID(
      EOA_Address.account!.address,
      originDomainID
    );
    await BridgeInstance.write.adminSetResource([
      ERC20HandlerInstance.address,
      resourceID_NonContract_Address,
      NonContract_Address,
      emptySetResourceData
    ]);
    await BridgeInstance.write.adminSetResource([
      ERC20HandlerInstance.address,
      resourceID_EOA_Address,
      EOA_Address.account!.address,
      emptySetResourceData
    ]);

    await expect(
      BridgeInstance.write.deposit([
        destinationDomainID,
        resourceID_NonContract_Address,
        depositData,
        feeData
      ],
        {
          account: depositor.account
        }
      )
    ).to.be.revertedWith("ERC20: not a contract");

    await expect(
      BridgeInstance.write.deposit([
        destinationDomainID,
        resourceID_EOA_Address,
        depositData,
        feeData
      ],
        {
          account: depositor.account
        }
      )
    ).to.be.revertedWith("ERC20: not a contract");
  });
});
