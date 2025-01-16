// The Licensed Work is (c) 2022 Sygma
// SPDX-License-Identifier: LGPL-3.0-only

import hre from 'hardhat';
import {ContractTypesMap} from "hardhat/types";
import {encodeFunctionData, Hex, toHex, WalletClient, zeroAddress} from "viem";
import {createMessageCallData, deploySourceChainContracts, getBalance} from "../helpers";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {assert, expect} from 'chai';
import {Action} from '../../types';


describe("DefaultMessageReceiver - direct interaction", () => {
  const transactionId = toHex(11, {size:32});

  let DefaultMessageReceiverInstance: ContractTypesMap["DefaultMessageReceiver"];
  let ERC20MintableInstance: ContractTypesMap["ERC20PresetMinterPauser"];
  let ForwarderInstance1: ContractTypesMap["Forwarder"];
  let ForwarderInstance2: ContractTypesMap["Forwarder"];

  let admin: WalletClient;
  let depositor: WalletClient;
  let handlerMock: WalletClient
  let recipient: WalletClient;
  let relayer1: WalletClient;

  let SYGMA_HANDLER_ROLE: Hex;

  beforeEach(async () => {
    ({
      DefaultMessageReceiverInstance,
      ERC20MintableInstance,
      ERC20MintableInstance,
      ForwarderInstance: ForwarderInstance1,
      ForwarderInstance: ForwarderInstance2,
    } = await loadFixture(deploySourceChainContracts));
    [
      admin,
      depositor,
      handlerMock,
      recipient,
      relayer1,
    ] = await hre.viem.getWalletClients();
    SYGMA_HANDLER_ROLE = await DefaultMessageReceiverInstance.read.SYGMA_HANDLER_ROLE();

    await ERC20MintableInstance.write.grantRole([
      await ERC20MintableInstance.read.MINTER_ROLE(),
      admin.account!.address
    ]);
  });

  it("should have valid defaults", async () => {
    assert.equal(await DefaultMessageReceiverInstance.read._recoverGas(), BigInt(100000));
    assert.isTrue(await DefaultMessageReceiverInstance.read.hasRole([SYGMA_HANDLER_ROLE, handlerMock.account!.address]));
  });

  it("should revert if caller doesn't have sygma handler role", async () => {
    await expect(
      DefaultMessageReceiverInstance.write.handleSygmaMessage([zeroAddress, 0, "0x"], {
        account: admin.account,
      }),
    ).to.be.revertedWithCustomError(DefaultMessageReceiverInstance, "InsufficientPermission()");
  });

  it("should revert on performActions if caller is not itself", async () => {
    await expect(
      DefaultMessageReceiverInstance.write.performActions([zeroAddress, zeroAddress, BigInt(0), []], {
        account: admin.account,
      }),
    ).to.be.revertedWithCustomError(DefaultMessageReceiverInstance, "InsufficientPermission()");
  });

  it("should revert on transferBalanceAction if caller is not itself", async () => {
    await expect(
      DefaultMessageReceiverInstance.write.transferBalanceAction([zeroAddress, zeroAddress], {
        account: admin.account,
      }),
    ).to.be.revertedWithCustomError(DefaultMessageReceiverInstance, "InsufficientPermission()");
  });

  it("should revert if message encoding is invalid", async () => {
    await expect(
      DefaultMessageReceiverInstance.write.handleSygmaMessage([zeroAddress, 0, "0x11"], {
        account: handlerMock.account,
      })
    ).to.be.reverted;
  });

  it("should revert if insufficient gas limit left for executing action", async () => {
    const actions: Array<Action> = [];
    const message = createMessageCallData(
      transactionId,
      actions,
      recipient.account!.address
    );
    await expect(
      DefaultMessageReceiverInstance.write.handleSygmaMessage([zeroAddress, BigInt(0), message], {
        account: handlerMock.account,
        gas: BigInt(100000),
      }),
    ).to.be.revertedWithCustomError(DefaultMessageReceiverInstance, "InsufficientGasLimit()");
  });

  it("should pass without actions", async () => {
    const actions: Array<Action> = [];
    const message = createMessageCallData(
      transactionId,
      actions,
      recipient.account!.address
    );
    await DefaultMessageReceiverInstance.write.handleSygmaMessage([zeroAddress, BigInt(0), message], {
      account: handlerMock.account,
      gas: BigInt(200000),
    });
  });

  it("should not return native token if not received during handling", async () => {
    const actions: Array<Action> = [];
    await depositor.sendTransaction({
      account: admin.account!.address,
      to: DefaultMessageReceiverInstance.address,
      value: BigInt(100),
      chain: null
    });
    const message = createMessageCallData(
      transactionId,
      actions,
      ForwarderInstance1.address // will revert if received native
    );
    await DefaultMessageReceiverInstance.write.handleSygmaMessage([zeroAddress, BigInt(0), message], {
      account: handlerMock.account,
      gas: BigInt(200000),
    });
    assert.equal(await getBalance(DefaultMessageReceiverInstance), BigInt(100));
  });

  it("should return full native token balance if contract balance increased during handling", async () => {
    const actions: Array<Action> = [];
    await depositor.sendTransaction({
      account: admin.account!.address,
      to: DefaultMessageReceiverInstance.address,
      value: BigInt(100),
      chain: null
    });
    const message = createMessageCallData(
      transactionId,
      actions,
      recipient.account!.address
    );
    const relayerBalanceBefore = await getBalance(recipient);
    await DefaultMessageReceiverInstance.write.handleSygmaMessage([zeroAddress, BigInt(0), message], {
      account: handlerMock.account,
      gas: BigInt(200000),
      value: BigInt(100),
    });
    const balanceAfter = await getBalance(recipient);
    assert.equal(balanceAfter, relayerBalanceBefore + BigInt(200));
    assert.equal(await getBalance(DefaultMessageReceiverInstance), BigInt(0));
  });

  it("should return full original token sent balance", async () => {
    const actions: Array<Action> = [];
    await ERC20MintableInstance.write.mint([DefaultMessageReceiverInstance.address, BigInt(333)]);
    const message = createMessageCallData(
      transactionId,
      actions,
      recipient.account!.address
    );
    await DefaultMessageReceiverInstance.write.handleSygmaMessage([
      ERC20MintableInstance.address,
      BigInt(333),
      message],
      {
        from: handlerMock,
        gas: BigInt(200000),
      }
    );
    const balanceAfter = await ERC20MintableInstance.read.balanceOf([recipient.account!.address]);
    assert.equal(balanceAfter, BigInt(333));
    assert.equal(await ERC20MintableInstance.read.balanceOf([DefaultMessageReceiverInstance.address]), BigInt(0));
  });

  it("should return full native token balance if contract balance increased during handling and actions reverted",
  async () => {
    const actions = [{
      nativeValue: BigInt(100),
      callTo: ForwarderInstance1.address,
      approveTo: zeroAddress,
      tokenSend: zeroAddress,
      tokenReceive: zeroAddress,
      data: "0x" as unknown as Hex,
    }];
    await depositor.sendTransaction({
      account: depositor.account!.address,
      to: DefaultMessageReceiverInstance.address,
      value: BigInt(100),
      chain: null
    });
    const message = createMessageCallData(
      transactionId,
      actions,
      recipient.account!.address
    );
    const relayerBalanceBefore = await getBalance(recipient);
    const handlerMessageTx = await DefaultMessageReceiverInstance.write.handleSygmaMessage([zeroAddress, BigInt(0), message], {
      account: handlerMock.account,
      gas: BigInt(200000),
      value: BigInt(100),
    });
    const balanceAfter = await getBalance(recipient);
    assert.equal(balanceAfter, relayerBalanceBefore + BigInt(200));
    assert.equal(await getBalance(DefaultMessageReceiverInstance), BigInt(0));

    await expect(handlerMessageTx).to.emit(DefaultMessageReceiverInstance, "TransferRecovered").withArgs(
      transactionId,
      zeroAddress,
      [recipient.account!.address],
      0
    );
  });

  it("should return full original token sent balance if actions reverted", async () => {
    const actions = [{
      nativeValue: BigInt(0),
      callTo: ForwarderInstance1.address,
      approveTo: zeroAddress,
      tokenSend: ERC20MintableInstance.address,
      tokenReceive: zeroAddress,
      data: "0x" as unknown as Hex,
    }];
    await ERC20MintableInstance.write.mint([DefaultMessageReceiverInstance.address, BigInt(333)]);
    const message = createMessageCallData(
      transactionId,
      actions,
      recipient.account!.address
    );
    const handlerMessageTx = await DefaultMessageReceiverInstance.write.handleSygmaMessage([
      ERC20MintableInstance.address,
      BigInt(333),
      message],
      {
        from: handlerMock,
        gas: BigInt(200000),
      }
    );
    const balanceAfter = await ERC20MintableInstance.read.balanceOf([recipient.account!.address]);
    assert.equal(balanceAfter, BigInt(333));
    assert.equal(await ERC20MintableInstance.read.balanceOf([DefaultMessageReceiverInstance.address]), BigInt(0));

    await expect(handlerMessageTx).to.emit(DefaultMessageReceiverInstance,"TransferRecovered").withArgs(
      transactionId,
      ERC20MintableInstance.address,
      [recipient.account!.address],
      333
    );
  });

  it("should return action tokens leftovers", async () => {
      const actionData = encodeFunctionData({
        abi: ["transfer(address recipient, uint256 amount)"],
        functionName: "transfer",
        args: [admin, 33]
      });

    const actions = [{
      nativeValue: BigInt(0),
      callTo: ERC20MintableInstance.address,
      approveTo: zeroAddress,
      tokenSend: zeroAddress,
      tokenReceive: ERC20MintableInstance.address,
      data: actionData as unknown as Hex,
    }];
    await ERC20MintableInstance.write.mint([DefaultMessageReceiverInstance.address, BigInt(333)]);
    const message = createMessageCallData(
      transactionId,
      actions,
      recipient.account!.address
    );
    const handleMessageTx = await DefaultMessageReceiverInstance.write.handleSygmaMessage([
      zeroAddress,
      BigInt(0),
      message],
      {
        account: handlerMock.account,
        gas: BigInt(200000),
      }
    );
    const balanceAfter = await ERC20MintableInstance.read.balanceOf([recipient.account!.address]);
    assert.equal(balanceAfter, BigInt(300));
    assert.equal(await ERC20MintableInstance.read.balanceOf([DefaultMessageReceiverInstance.address]), BigInt(0));
    assert.equal(await ERC20MintableInstance.read.balanceOf([admin.account!.address]), BigInt(33));

    await expect(handleMessageTx).to.emit(DefaultMessageReceiverInstance, "Executed").withArgs(
      transactionId,
      zeroAddress,
      recipient.account!.address,
      0
    );
  });

  it("should give approval to the approveTo then revoke it", async () => {
    // DMR -> Forwarder.execute -> Forwarder2.execute -> Token.transferFrom(DMR, admin)
    const transferFromActionData = encodeFunctionData({
      abi: ["transferFrom(address sender, address recipient, uint256 amount)"],
      functionName: "transferFrom",
      args: [DefaultMessageReceiverInstance.address, admin.account!.address, 33]
    });
    const transferFromExecuteActionData = encodeFunctionData({
      abi: ["execute(ForwardRequest req, bytes signature)"],
      functionName: "execute",
      args: [transferFromActionData, ERC20MintableInstance.address, zeroAddress]
    });
    const actionData = encodeFunctionData({
      abi: ["execute(ForwardRequest req, bytes signature)"],
      functionName: "execute",
      args: [transferFromExecuteActionData, ForwarderInstance2.address, zeroAddress]
    });
    const actions = [{
      nativeValue: BigInt(0),
      callTo: ForwarderInstance1.address,
      approveTo: ForwarderInstance2.address,
      tokenSend: ERC20MintableInstance.address,
      tokenReceive: zeroAddress,
      data: actionData,
    }];

    await ERC20MintableInstance.write.mint([DefaultMessageReceiverInstance.address, BigInt(333)]);
    const message = createMessageCallData(
      transactionId,
      actions,
      recipient.account!.address
    );
    const handlerMessageTx = await DefaultMessageReceiverInstance.write.handleSygmaMessage([
      ERC20MintableInstance.address,
      BigInt(333),
      message],
      {
        from: handlerMock.account,
        gas: BigInt(500000),
      }
    );
    const balanceAfter = await ERC20MintableInstance.read.balanceOf([recipient.account!.address]);
    assert.equal(balanceAfter, BigInt(300));
    assert.equal(await ERC20MintableInstance.read.balanceOf([DefaultMessageReceiverInstance.address]), BigInt(0));
    assert.equal(await ERC20MintableInstance.read.balanceOf([admin.account!.address]), BigInt(33));
    await expect(handlerMessageTx).to.emit(DefaultMessageReceiverInstance, "Executed").withArgs(
      transactionId,
      ERC20MintableInstance.address,
      recipient,
      BigInt(333)
    );
    assert.equal(await ERC20MintableInstance.read.allowance([
      DefaultMessageReceiverInstance.address, ForwarderInstance2.address]),
      BigInt(0)
    );
    assert.equal(await ERC20MintableInstance.read.allowance([
      DefaultMessageReceiverInstance.address, ForwarderInstance1.address]),
      BigInt(0)
    );
  });

  it("should revert if callTo is EOA and data is not empty", async () => {
    const actions = [{
      nativeValue: BigInt(0),
      callTo: admin.account!.address,
      approveTo: zeroAddress,
      tokenSend: zeroAddress,
      tokenReceive: zeroAddress,
      data: "0x11" as unknown as Hex,
    }];
    const message = createMessageCallData(
      transactionId,
      actions,
      recipient.account!.address
    );
    const handlerMessageTx = await DefaultMessageReceiverInstance.write.handleSygmaMessage([
      zeroAddress,
      BigInt(0),
      message],
      {
        account: handlerMock.account,
        gas: BigInt(200000),
      }
    );
    await expect(handlerMessageTx).to.emit(DefaultMessageReceiverInstance, "TransferRecovered").withArgs(
      transactionId,
      zeroAddress,
      recipient,
      BigInt(0)
    );
  });

  it("should succeed if callTo is EOA and data is empty", async () => {
    const actions = [{
      nativeValue: BigInt(0),
      callTo: admin.account!.address,
      approveTo: zeroAddress,
      tokenSend: zeroAddress,
      tokenReceive: zeroAddress,
      data: "0x" as unknown as Hex,
    }];
    const message = createMessageCallData(
      transactionId,
      actions,
      recipient.account!.address
    );
    const handlerMessageTx = await DefaultMessageReceiverInstance.write.handleSygmaMessage([
      zeroAddress,
      BigInt(0),
      message],
      {
        account: handlerMock.account,
        gas: BigInt(200000),
      }
    );

    await expect(handlerMessageTx).to.emit(DefaultMessageReceiverInstance, "Executed").withArgs(
      transactionId,
      zeroAddress,
      recipient.account!.address,
      0
    );
  });

  it("should send native token as part of the action", async () => {
    const actions = [{
      nativeValue: BigInt(100),
      callTo: relayer1.account!.address,
      approveTo: zeroAddress,
      tokenSend: zeroAddress,
      tokenReceive: zeroAddress,
      data: "0x" as unknown as Hex,
    }];
    const message = createMessageCallData(
      transactionId,
      actions,
      recipient
    );
    const relayerBalanceBefore = await getBalance(relayer1);
    const handleMessageTx = await DefaultMessageReceiverInstance.write.handleSygmaMessage([
      zeroAddress,
      BigInt(0),
      message],
      {
        from: handlerMock,
        gas: BigInt(200000),
        value: BigInt(300),
      }
    );
    const balanceAfter = await getBalance(relayer1);
    assert.equal(balanceAfter, relayerBalanceBefore + BigInt(100));
    assert.equal(await getBalance(DefaultMessageReceiverInstance), BigInt(0));

    await expect(handleMessageTx).to.emit(DefaultMessageReceiverInstance, "Executed").withArgs(
      transactionId,
      zeroAddress,
      recipient.account!.address,
      0
    );
  });

  it("should revert if has too little gas after actions", async () => {
    // DMR -> Forwarder.execute -> Forwarder2.execute -> Token.transferFrom(DMR, admin)
    const transferFromActionData = encodeFunctionData({
      abi: ["transferFrom(address sender, address recipient, uint256 amount)"],
      functionName: "transferFrom",
      args: [DefaultMessageReceiverInstance.address, admin.account!.address, 33]
    });
    const transferFromExecuteActionData = encodeFunctionData({
      abi: ["execute(ForwardRequest req, bytes signature)"],
      functionName: "execute",
      args: [transferFromActionData, ERC20MintableInstance.address, zeroAddress]
    });
    const actionData = encodeFunctionData({
      abi: ["execute(ForwardRequest req, bytes signature)"],
      functionName: "execute",
      args: [transferFromExecuteActionData, ForwarderInstance2.address, zeroAddress]
    });
    const actions = [{
      nativeValue: BigInt(0),
      callTo: ForwarderInstance1.address,
      approveTo: ForwarderInstance2.address,
      tokenSend: ERC20MintableInstance.address,
      tokenReceive: zeroAddress,
      data: actionData,
    }];

    await ERC20MintableInstance.write.mint([DefaultMessageReceiverInstance.address, BigInt(333)]);
    const message = createMessageCallData(
      transactionId,
      actions,
      recipient.account!.address
    );
    await expect(
      DefaultMessageReceiverInstance.write.handleSygmaMessage([
        ERC20MintableInstance.address,
        BigInt(333),
        message],
        {
          account: handlerMock.account,
          gas: BigInt(200000),
        }
      ),
    ).to.be.revertedWithCustomError(DefaultMessageReceiverInstance, "InsufficientGasLimit()");
  });

  it("should execute transferBalanceAction", async () => {
    const transferBalanceActionData1 = encodeFunctionData({
      abi: ["transferBalanceAction(address token, address receiver)"],
      functionName: "transferBalanceAction",
      args: [zeroAddress, relayer1.account!.address]
    });

    const transferBalanceActionData2 = encodeFunctionData({
      abi: ["transferBalanceAction(address token, address receiver)"],
      functionName: "transferBalanceAction",
      args: [ERC20MintableInstance.address, relayer1.account!.address]
    });

    const actions = [{
      nativeValue: BigInt(0),
      callTo: DefaultMessageReceiverInstance.address,
      approveTo: zeroAddress,
      tokenSend: zeroAddress,
      tokenReceive: zeroAddress,
      data: transferBalanceActionData1,
    }, {
      nativeValue: BigInt(0),
      callTo: DefaultMessageReceiverInstance.address,
      approveTo: zeroAddress,
      tokenSend: zeroAddress,
      tokenReceive: zeroAddress,
      data: transferBalanceActionData2,
    }];
    const message = createMessageCallData(
      transactionId,
      actions,
      recipient.account!.address
    );
    await ERC20MintableInstance.write.mint([DefaultMessageReceiverInstance.address, BigInt(333)]);
    const relayerBalanceBefore = await getBalance(relayer1);
    const handlerMessageTx = await DefaultMessageReceiverInstance.write.handleSygmaMessage([
      zeroAddress,
      BigInt(0),
      message],
      {
        from: handlerMock,
        gas: BigInt(200000),
        value: BigInt(300),
      }
    );
    const balanceAfter = await getBalance(relayer1);
    assert.equal(balanceAfter, relayerBalanceBefore + BigInt(300));
    assert.equal(await getBalance(DefaultMessageReceiverInstance), BigInt(0));
    assert.equal(await ERC20MintableInstance.read.balanceOf([DefaultMessageReceiverInstance.address]), BigInt(0));
    assert.equal(await ERC20MintableInstance.read.balanceOf([relayer1.account!.address]), BigInt(333));

    await expect(handlerMessageTx).to.emit(DefaultMessageReceiverInstance, "Executed").withArgs(
      transactionId,
      zeroAddress,
      recipient,
      0
    );
  });
});
