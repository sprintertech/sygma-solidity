// The Licensed Work is (c) 2022 Sygma
// SPDX-License-Identifier: LGPL-3.0-only

const TruffleAssert = require("truffle-assertions");
const Ethers = require("ethers");

const Helpers = require("../test/helpers");
const dotenv = require("dotenv");
dotenv.config();

const ERC20HandlerContract = artifacts.require("ERC20Handler");
const DefaultMessageReceiverContract = artifacts.require("DefaultMessageReceiver"); 
const FeeHandlerRouterContract = artifacts.require("FeeHandlerRouter"); 
const BasicFeeHandlerContract = artifacts.require("BasicFeeHandler"); 
const NativeTokenAdapterContract = artifacts.require("NativeTokenAdapter");  
const NativeTokenHandlerContract = artifacts.require("NativeTokenHandler");  
const SwapAdapterContract = artifacts.require("SwapAdapter");
const ERC20MintableContract = artifacts.require("ERC20PresetMinterPauser");

contract("SwapAdapter", async (accounts) => {
  // Fee handler is mocked by BasicFeeHandler
  // deploy bridge, ERC20Handler, NativeTokenHandler, BasicFeeHandler, SwapAdapter
  // use SwapRouter, USDC, WETH, user with USDC, user with ETH from mainnet fork
  const recipientAddress = accounts[2];
  const fee = 1000;
  const depositorAddress = accounts[3];
  const emptySetResourceData = "0x";
  const originDomainID = 1;
  const destinationDomainID = 3;
  const executionGasAmount = 30000000;
  const expectedDepositNonce = 1;
  const WETH_ADDRESS = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
  const USDC_ADDRESS = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
  const USDC_OWNER_ADDRESS =  process.env.USDC_OWNER_ADDRESS;
  const UNISWAP_SWAP_ROUTER_ADDRESS = "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45";
  const resourceID_USDC = Helpers.createResourceID(
    USDC_ADDRESS,
    originDomainID
  );
  const resourceID_Native = "0x0000000000000000000000000000000000000000000000000000000000000650";
  const transactionId = "0x0000000000000000000000000000000000000000000000000000000000000001";

  let BridgeInstance;
  let DefaultMessageReceiverInstance;
  let BasicFeeHandlerInstance;
  let ERC20HandlerInstance;
  let ERC20MintableInstance;
  let NativeTokenAdapterInstance;
  let NativeTokenHandlerInstance;
  let SwapAdapterInstance;
  let usdc;
  let weth;
  let message;

  beforeEach(async () => {
    BridgeInstance = await Helpers.deployBridge(
        originDomainID,
        accounts[0]
      );
    DefaultMessageReceiverInstance = await DefaultMessageReceiverContract.new([], 100000);
    ERC20HandlerInstance = await ERC20HandlerContract.new(
      BridgeInstance.address,
      DefaultMessageReceiverInstance.address
    );
    ERC20MintableInstance = await ERC20MintableContract.new(
      "token",
      "TOK"
    );
    FeeHandlerRouterInstance = await FeeHandlerRouterContract.new(
      BridgeInstance.address
    );
    BasicFeeHandlerInstance = await BasicFeeHandlerContract.new(
      BridgeInstance.address,
      FeeHandlerRouterInstance.address
    );
    NativeTokenAdapterInstance = await NativeTokenAdapterContract.new(
      BridgeInstance.address,
      resourceID_Native
    );
    NativeTokenHandlerInstance = await NativeTokenHandlerContract.new(
      BridgeInstance.address,
      NativeTokenAdapterInstance.address,
      DefaultMessageReceiverInstance.address
    );
    SwapAdapterInstance = await SwapAdapterContract.new(
      BridgeInstance.address,
      WETH_ADDRESS,
      UNISWAP_SWAP_ROUTER_ADDRESS,
      NativeTokenAdapterInstance.address
    );
    usdc = await ERC20MintableContract.at(USDC_ADDRESS);
    weth = await ERC20MintableContract.at(WETH_ADDRESS);

    await BridgeInstance.adminSetResource(
      NativeTokenHandlerInstance.address,
      resourceID_Native,
      NativeTokenHandlerInstance.address,
      emptySetResourceData
    );

    await BridgeInstance.adminSetResource(
      ERC20HandlerInstance.address,
      resourceID_USDC,
      USDC_ADDRESS,
      emptySetResourceData
    );

    await BasicFeeHandlerInstance.changeFee(destinationDomainID, resourceID_Native, fee);
    await BasicFeeHandlerInstance.changeFee(destinationDomainID, resourceID_USDC, fee);
    await BridgeInstance.adminChangeFeeHandler(FeeHandlerRouterInstance.address),
    await FeeHandlerRouterInstance.adminSetResourceHandler(
      destinationDomainID,
      resourceID_Native,
      BasicFeeHandlerInstance.address
    );

    await FeeHandlerRouterInstance.adminSetResourceHandler(
      destinationDomainID,
      resourceID_USDC,
      BasicFeeHandlerInstance.address
    );

    const mintableERC20Iface = new Ethers.utils.Interface(["function mint(address to, uint256 amount)"]);
    const actions = [{
      nativeValue: 0,
      callTo: ERC20MintableInstance.address,
      approveTo: Ethers.constants.AddressZero,
      tokenSend: Ethers.constants.AddressZero,
      tokenReceive: Ethers.constants.AddressZero,
      data: mintableERC20Iface.encodeFunctionData("mint", [recipientAddress, "20"]),
    }];
    message = Helpers.createMessageCallData(
      transactionId,
      actions,
      DefaultMessageReceiverInstance.address
    );

    // set MPC address to unpause the Bridge
    await BridgeInstance.endKeygen(Helpers.mpcAddress);
  });

  it("should swap tokens to ETH and bridge ETH", async () => {
    const pathTokens = [WETH_ADDRESS, USDC_ADDRESS];
    const pathFees = [500];
    const amountInMax = 1000000;
    const amountOut = Ethers.utils.parseUnits("200000", "gwei");
    await SwapAdapterInstance.setTokenResourceID(USDC_ADDRESS, resourceID_USDC);
    await usdc.approve(SwapAdapterInstance.address, amountInMax, {from: USDC_OWNER_ADDRESS});
    const balanceBefore = await usdc.balanceOf(USDC_OWNER_ADDRESS);
    const depositTx = await SwapAdapterInstance.depositTokensToEth(
      destinationDomainID,
      recipientAddress,
      USDC_ADDRESS,
      amountInMax,
      amountOut,
      pathTokens,
      pathFees,
      {from: USDC_OWNER_ADDRESS}
    );
    expect(await web3.eth.getBalance(SwapAdapterInstance.address)).to.eq("0");
    expect(await web3.eth.getBalance(BasicFeeHandlerInstance.address)).to.eq(fee.toString());
    expect(await web3.eth.getBalance(NativeTokenHandlerInstance.address)).to.not.eq("0");

    const depositCount = await BridgeInstance._depositCounts.call(
      destinationDomainID
    );
    const expectedDepositNonce = 1;
    assert.strictEqual(depositCount.toNumber(), expectedDepositNonce);

    const internalTx = await TruffleAssert.createTransactionResult(
      BridgeInstance,
      depositTx.tx
    );

    const events = await SwapAdapterInstance.getPastEvents("TokensSwapped", {fromBlock: depositTx.receipt.blockNumber});
    const amountIn = events[events.length - 1].args.amountIn;

    const balanceAfter = await usdc.balanceOf(USDC_OWNER_ADDRESS);
    expect(balanceAfter.toNumber()).to.eq(balanceBefore - amountIn);
    expect(balanceAfter.toNumber()).to.be.gt(balanceBefore - amountInMax);

    const depositData = await Helpers.createERCDepositData(amountOut, 20, recipientAddress);

    TruffleAssert.eventEmitted(internalTx, "Deposit", (event) => {
      return (
        event.destinationDomainID.toNumber() === destinationDomainID &&
        event.resourceID === resourceID_Native.toLowerCase() &&
        event.depositNonce.toNumber() === expectedDepositNonce &&
        event.user === NativeTokenAdapterInstance.address &&
        event.data === depositData.toLowerCase() &&
        event.handlerResponse === null
      );
    });
  });

  it("should swap ETH to tokens and bridge tokens", async () => {
    const pathTokens = [USDC_ADDRESS, WETH_ADDRESS];
    const pathFees = [500];
    const amountInMax = Ethers.utils.parseEther("1");
    const amountOut = 2000000000;
    await SwapAdapterInstance.setTokenResourceID(USDC_ADDRESS, resourceID_USDC);
    const balanceBefore = await web3.eth.getBalance(depositorAddress);
    const depositTx = await SwapAdapterInstance.depositEthToTokens(
      destinationDomainID,
      recipientAddress,
      USDC_ADDRESS,
      amountOut,
      pathTokens,
      pathFees,
      {
        value: amountInMax,
        from: depositorAddress
      }
    );
    const balanceAfter = await web3.eth.getBalance(depositorAddress);
    expect((await usdc.balanceOf(SwapAdapterInstance.address)).toString()).to.eq("0");
    expect(await web3.eth.getBalance(SwapAdapterInstance.address)).to.eq("0");
    expect(await web3.eth.getBalance(BridgeInstance.address)).to.eq("0");
    expect(await web3.eth.getBalance(FeeHandlerRouterInstance.address)).to.eq("0");
    expect(await web3.eth.getBalance(ERC20HandlerInstance.address)).to.eq("0");
    expect(await web3.eth.getBalance(UNISWAP_SWAP_ROUTER_ADDRESS)).to.eq("0");
    expect((await weth.balanceOf(UNISWAP_SWAP_ROUTER_ADDRESS)).toNumber()).to.eq(0);
    expect((await weth.balanceOf(SwapAdapterInstance.address)).toNumber()).to.eq(0);
    expect((await usdc.balanceOf(ERC20HandlerInstance.address)).toString()).to.eq(amountOut.toString());

    expect(await web3.eth.getBalance(BasicFeeHandlerInstance.address)).to.eq(fee.toString());
    expect((await usdc.balanceOf(ERC20HandlerInstance.address)).toNumber()).to.eq(amountOut);

    const depositCount = await BridgeInstance._depositCounts.call(
      destinationDomainID
    );
    const expectedDepositNonce = 1;
    assert.strictEqual(depositCount.toNumber(), expectedDepositNonce);

    const internalTx = await TruffleAssert.createTransactionResult(
      BridgeInstance,
      depositTx.tx
    );

    const events = await SwapAdapterInstance.getPastEvents("TokensSwapped", {fromBlock: depositTx.receipt.blockNumber});
    const amountIn = events[events.length - 1].args.amountIn;
    const gasPrice = (await web3.eth.getTransactionReceipt(
      depositTx.tx
    )).effectiveGasPrice;
    const txCost = gasPrice * depositTx.receipt.gasUsed;
    assert.equal(Ethers.BigNumber.from(balanceAfter).toString(),
      Ethers.BigNumber.from(balanceBefore).sub(amountIn.toString()).sub(txCost).sub(fee).toString());

    const depositData = await Helpers.createERCDepositData(amountOut, 20, recipientAddress);

    TruffleAssert.eventEmitted(internalTx, "Deposit", (event) => {
      return (
        event.destinationDomainID.toNumber() === destinationDomainID &&
        event.resourceID === resourceID_USDC.toLowerCase() &&
        event.depositNonce.toNumber() === expectedDepositNonce &&
        event.user === SwapAdapterInstance.address &&
        event.data === depositData.toLowerCase() &&
        event.handlerResponse === null
      );
    });
  });

  it("should swap tokens to ETH and bridge ETH with contract call", async () => {
    const pathTokens = [WETH_ADDRESS, USDC_ADDRESS];
    const pathFees = [500];
    const amountInMax = 1000000;
    const amountOut = Ethers.utils.parseUnits("200000", "gwei");
    await SwapAdapterInstance.setTokenResourceID(USDC_ADDRESS, resourceID_USDC);
    await usdc.approve(SwapAdapterInstance.address, amountInMax, {from: USDC_OWNER_ADDRESS});
    const balanceBefore = await usdc.balanceOf(USDC_OWNER_ADDRESS);
    const depositTx = await SwapAdapterInstance.depositTokensToEthWithMessage(
      destinationDomainID,
      recipientAddress,
      executionGasAmount,
      message,
      USDC_ADDRESS,
      amountInMax,
      amountOut,
      pathTokens,
      pathFees,
      {from: USDC_OWNER_ADDRESS}
    );
    expect(await web3.eth.getBalance(SwapAdapterInstance.address)).to.eq("0");
    expect(await web3.eth.getBalance(BasicFeeHandlerInstance.address)).to.eq(fee.toString());
    expect(await web3.eth.getBalance(NativeTokenHandlerInstance.address)).to.not.eq("0");

    const depositCount = await BridgeInstance._depositCounts.call(
      destinationDomainID
    );
    assert.strictEqual(depositCount.toNumber(), expectedDepositNonce);

    const internalTx = await TruffleAssert.createTransactionResult(
      BridgeInstance,
      depositTx.tx
    );

    const events = await SwapAdapterInstance.getPastEvents("TokensSwapped", {fromBlock: depositTx.receipt.blockNumber});
    const amountIn = events[events.length - 1].args.amountIn;

    const balanceAfter = await usdc.balanceOf(USDC_OWNER_ADDRESS);
    expect(balanceAfter.toNumber()).to.eq(balanceBefore - amountIn);
    expect(balanceAfter.toNumber()).to.be.gt(balanceBefore - amountInMax);

    const depositData = await Helpers.createOptionalContractCallDepositData(
      amountOut,
      recipientAddress,
      executionGasAmount,
      message
    );

    TruffleAssert.eventEmitted(internalTx, "Deposit", (event) => {
      return (
        event.destinationDomainID.toNumber() === destinationDomainID &&
        event.resourceID === resourceID_Native.toLowerCase() &&
        event.depositNonce.toNumber() === expectedDepositNonce &&
        event.user === NativeTokenAdapterInstance.address &&
        event.data === depositData.toLowerCase() &&
        event.handlerResponse === null
      );
    });
  });

  it("should swap ETH to tokens and bridge tokens with contract call", async () => {
    const pathTokens = [USDC_ADDRESS, WETH_ADDRESS];
    const pathFees = [500];
    const amountInMax = Ethers.utils.parseEther("1");
    const amountOut = 2000000000;
    await SwapAdapterInstance.setTokenResourceID(USDC_ADDRESS, resourceID_USDC);
    const balanceBefore = await web3.eth.getBalance(depositorAddress);
    const depositTx = await SwapAdapterInstance.depositEthToTokensWithMessage(
      destinationDomainID,
      recipientAddress,
      executionGasAmount,
      message,
      USDC_ADDRESS,
      amountOut,
      pathTokens,
      pathFees,
      {
        value: amountInMax,
        from: depositorAddress
      }
    );
    const balanceAfter = await web3.eth.getBalance(depositorAddress);
    expect((await usdc.balanceOf(SwapAdapterInstance.address)).toString()).to.eq("0");
    expect(await web3.eth.getBalance(SwapAdapterInstance.address)).to.eq("0");
    expect(await web3.eth.getBalance(BridgeInstance.address)).to.eq("0");
    expect(await web3.eth.getBalance(FeeHandlerRouterInstance.address)).to.eq("0");
    expect(await web3.eth.getBalance(BasicFeeHandlerInstance.address)).to.eq(fee.toString());
    expect(await usdc.balanceOf(ERC20HandlerInstance.address)).to.not.eq("0");
    expect((await usdc.balanceOf(ERC20HandlerInstance.address)).toString()).to.eq(amountOut.toString());

    const depositCount = await BridgeInstance._depositCounts.call(
      destinationDomainID
    );
    const expectedDepositNonce = 1;
    assert.strictEqual(depositCount.toNumber(), expectedDepositNonce);

    const internalTx = await TruffleAssert.createTransactionResult(
      BridgeInstance,
      depositTx.tx
    );

    const events = await SwapAdapterInstance.getPastEvents("TokensSwapped", {fromBlock: depositTx.receipt.blockNumber});
    const amountIn = events[events.length - 1].args.amountIn;

    const gasPrice = (await web3.eth.getTransactionReceipt(
      depositTx.tx
    )).effectiveGasPrice;
    const txCost = gasPrice * depositTx.receipt.gasUsed;
    assert.equal(Ethers.BigNumber.from(balanceAfter).toString(),
      Ethers.BigNumber.from(balanceBefore).sub(amountIn.toString()).sub(txCost).sub(fee).toString());

    const depositData = await Helpers.createOptionalContractCallDepositData(
      amountOut,
      recipientAddress,
      executionGasAmount,
      message
    );

    TruffleAssert.eventEmitted(internalTx, "Deposit", (event) => {
      return (
        event.destinationDomainID.toNumber() === destinationDomainID &&
        event.resourceID === resourceID_USDC.toLowerCase() &&
        event.depositNonce.toNumber() === expectedDepositNonce &&
        event.user === SwapAdapterInstance.address &&
        event.data === depositData.toLowerCase() &&
        event.handlerResponse === null
      );
    });
  });

  it("should fail if no approve", async () => {
    const pathTokens = [USDC_ADDRESS, WETH_ADDRESS];
    const pathFees = [500];
    const amount = 1000000;
    const amountOutMinimum = Ethers.utils.parseUnits("200000", "gwei");
    await SwapAdapterInstance.setTokenResourceID(USDC_ADDRESS, resourceID_USDC);
    await Helpers.reverts(
      SwapAdapterInstance.depositTokensToEth(
        destinationDomainID,
        recipientAddress,
        USDC_ADDRESS,
        amount,
        amountOutMinimum,
        pathTokens,
        pathFees,
        {from: USDC_OWNER_ADDRESS}
      )
    );
  });

  it("should fail if the path is invalid [tokens length and fees length]", async () => {
    const pathTokens = [WETH_ADDRESS, USDC_ADDRESS];
    const pathFees = [500, 300];
    const amount = 1000000;
    const amountOutMinimum = Ethers.utils.parseUnits("200000", "gwei");
    await SwapAdapterInstance.setTokenResourceID(USDC_ADDRESS, resourceID_USDC);
    await usdc.approve(SwapAdapterInstance.address, amount, {from: USDC_OWNER_ADDRESS});
    await Helpers.expectToRevertWithCustomError(
      SwapAdapterInstance.depositTokensToEth.call(
        destinationDomainID,
        recipientAddress,
        USDC_ADDRESS,
        amount,
        amountOutMinimum,
        pathTokens,
        pathFees,
        {from: USDC_OWNER_ADDRESS}
      ),
      "PathInvalid()"
    );
  });

  it("should fail if the path is invalid [tokenIn is not token0]", async () => {
    const pathTokens = [USDC_ADDRESS, WETH_ADDRESS];
    const pathFees = [500];
    const amount = 1000000;
    const amountOutMinimum = Ethers.utils.parseUnits("200000", "gwei");
    await SwapAdapterInstance.setTokenResourceID(USDC_ADDRESS, resourceID_USDC);
    await usdc.approve(SwapAdapterInstance.address, amount, {from: USDC_OWNER_ADDRESS});
    await Helpers.expectToRevertWithCustomError(
      SwapAdapterInstance.depositTokensToEth.call(
        destinationDomainID,
        recipientAddress,
        USDC_ADDRESS,
        amount,
        amountOutMinimum,
        pathTokens,
        pathFees,
        {from: USDC_OWNER_ADDRESS}
      ),
      "PathInvalid()"
    );
  });

  it("should fail if the path is invalid  [tokenOut is not weth]", async () => {
    const pathTokens = [USDC_ADDRESS, USDC_ADDRESS];
    const pathFees = [500];
    const amount = 1000000;
    const amountOutMinimum = Ethers.utils.parseUnits("200000", "gwei");
    await SwapAdapterInstance.setTokenResourceID(USDC_ADDRESS, resourceID_USDC);
    await usdc.approve(SwapAdapterInstance.address, amount, {from: USDC_OWNER_ADDRESS});
    await Helpers.expectToRevertWithCustomError(
      SwapAdapterInstance.depositTokensToEth.call(
        destinationDomainID,
        recipientAddress,
        USDC_ADDRESS,
        amount,
        amountOutMinimum,
        pathTokens,
        pathFees,
        {from: USDC_OWNER_ADDRESS}
      ),
      "PathInvalid()"
    );
  });

  it("should fail if the resource id is not configured", async () => {
    const pathTokens = [WETH_ADDRESS, USDC_ADDRESS];
    const pathFees = [500];
    const amount = 1000000;
    const amountOutMinimum = Ethers.utils.parseUnits("200000", "gwei");
    await usdc.approve(SwapAdapterInstance.address, amount, {from: USDC_OWNER_ADDRESS});
    await Helpers.expectToRevertWithCustomError(
      SwapAdapterInstance.depositTokensToEth.call(
        destinationDomainID,
        recipientAddress,
        USDC_ADDRESS,
        amount,
        amountOutMinimum,
        pathTokens,
        pathFees,
        {from: USDC_OWNER_ADDRESS}
      ),
      "TokenInvalid()"
    );
  });

  it("should fail if no msg.value supplied", async () => {
    const pathTokens = [WETH_ADDRESS, USDC_ADDRESS];
    const pathFees = [500];
    const amountOutMinimum = 2000000000;
    await SwapAdapterInstance.setTokenResourceID(USDC_ADDRESS, resourceID_USDC);
    await Helpers.expectToRevertWithCustomError(
        SwapAdapterInstance.depositEthToTokens.call(
        destinationDomainID,
        recipientAddress,
        USDC_ADDRESS,
        amountOutMinimum,
        pathTokens,
        pathFees,
        {
          value: 0,
          from: depositorAddress
        }
      ),
      "InsufficientAmount(uint256)"
    );
  });

  it("should fail if msg.value is less than fee", async () => {
    const pathTokens = [WETH_ADDRESS, USDC_ADDRESS];
    const pathFees = [500];
    const amountOutMinimum = 2000000000;
    await SwapAdapterInstance.setTokenResourceID(USDC_ADDRESS, resourceID_USDC);
    await Helpers.expectToRevertWithCustomError(
        SwapAdapterInstance.depositEthToTokens.call(
        destinationDomainID,
        recipientAddress,
        USDC_ADDRESS,
        amountOutMinimum,
        pathTokens,
        pathFees,
        {
          value: 5,
          from: depositorAddress
        }
      ),
      "MsgValueLowerThanFee(uint256)"
    );
  });
});
