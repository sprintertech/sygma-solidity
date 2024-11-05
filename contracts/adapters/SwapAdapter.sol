// The Licensed Work is (c) 2022 Sygma
// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.11;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../../contracts/interfaces/IBridge.sol";
import "../../contracts/interfaces/IFeeHandler.sol";
import "../../contracts/adapters/interfaces/INativeTokenAdapter.sol";
import "../../contracts/adapters/interfaces/IWETH.sol";
import "../../contracts/adapters/interfaces/IV3SwapRouter.sol";
import "../../contracts/adapters/interfaces/IPeripheryPayments.sol";

/**
    @title Contract that swaps tokens to ETH or ETH to tokens using Uniswap
        and then makes a deposit to the Bridge.
    @author ChainSafe Systems.
 */
contract SwapAdapter is AccessControl {

    using SafeERC20 for IERC20;

    IBridge public immutable _bridge;
    address public immutable _weth;
    IV3SwapRouter public immutable _swapRouter;
    INativeTokenAdapter public immutable _nativeTokenAdapter;

    mapping(address => bytes32) public tokenToResourceID;

    // Used to avoid "stack too deep" error
    struct LocalVars {
        uint256 fee;
        uint256 totalAmountOut;
        uint256 amountIn;
        uint256 swapAmount;
        address feeHandlerRouter;
        bytes32 resourceID;
        address ERC20HandlerAddress;
        uint256 leftover;
        bytes depositDataAfterAmount;
        bytes path;
        IV3SwapRouter.ExactInputParams params;
        bytes depositData;
    }

    error CallerNotAdmin();
    error AlreadySet();
    error TokenInvalid();
    error PathInvalid();
    error MsgValueLowerThanFee(uint256 value);
    error InsufficientAmount(uint256 amount);
    error FailedFundsTransfer();
    error AmountLowerThanFee(uint256 amount);

    event TokenResourceIDSet(address token, bytes32 resourceID);
    event TokensSwapped(address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut);

    constructor(
        IBridge bridge,
        address weth,
        IV3SwapRouter swapRouter,
        INativeTokenAdapter nativeTokenAdapter
    ) {
        _bridge = bridge;
        _weth = weth;
        _swapRouter = swapRouter;
        _nativeTokenAdapter = nativeTokenAdapter;
        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    modifier onlyAdmin() {
        if (!hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) revert CallerNotAdmin();
        _;
    }

    // Admin functions
    function setTokenResourceID(address token, bytes32 resourceID) external onlyAdmin {
        if (tokenToResourceID[token] == resourceID) revert AlreadySet();
        tokenToResourceID[token] = resourceID;
        emit TokenResourceIDSet(token, resourceID);
    }

    /**
        @notice Function for depositing tokens, performing swap to ETH and bridging the ETH.
        @param destinationDomainID  ID of chain deposit will be bridged to.
        @param recipient Recipient of the deposit.
        @param token Input token to be swapped.
        @param amountInMax Max amount of input tokens to be swapped. It should exceed the desired
            amount of output tokens because the amount of swapped ETH should also cover the bridging fee.
            It's equal to tokenSwapRate * (amountOut + bridging fee)
        @param amountOut Amount of ETH to be bridged.
        @param pathTokens Addresses of the tokens for Uniswap swap (in reverse order). WETH address is used for ETH.
        @param pathFees Fees for Uniswap pools (in reverse order).
    */
    function depositTokensToEth(
        uint8 destinationDomainID,
        address recipient,
        address token,
        uint256 amountInMax,
        uint256 amountOut,
        address[] calldata pathTokens,
        uint24[] calldata pathFees
    ) external {
        LocalVars memory vars;
        vars.resourceID = tokenToResourceID[token];
        if (vars.resourceID == bytes32(0)) revert TokenInvalid();

        // Compose depositData
        vars.depositDataAfterAmount = abi.encodePacked(
            uint256(20),
            recipient
        );

        vars.feeHandlerRouter = _bridge._feeHandler();
        (vars.fee, ) = IFeeHandler(vars.feeHandlerRouter).calculateFee(
            address(this),
            _bridge._domainID(),
            destinationDomainID,
            vars.resourceID,
            abi.encodePacked(amountOut, vars.depositDataAfterAmount),
            ""  // feeData - not parsed
        );

        vars.totalAmountOut = amountOut + vars.fee;

        // Swap tokens to ETH (exact output)
        IERC20(token).safeTransferFrom(msg.sender, address(this), amountInMax);
        IERC20(token).safeApprove(address(_swapRouter), amountInMax);

        vars.amountIn = swapTokens(
            pathTokens,
            pathFees,
            token,
            _weth,
            amountInMax,
            vars.totalAmountOut,
            0
        );

        IWETH(_weth).withdraw(vars.totalAmountOut);

        // Make Native Token deposit
        _nativeTokenAdapter.depositToEVM{value: vars.totalAmountOut}(destinationDomainID, recipient);

        // Refund tokens
        if (vars.amountIn < amountInMax) {
            IERC20(token).safeApprove(address(_swapRouter), 0);
            IERC20(token).safeTransfer(msg.sender, amountInMax - vars.amountIn);
        }

        // Return unspent fee to msg.sender
        uint256 leftover = address(this).balance;
        if (leftover > 0) {
            payable(msg.sender).call{value: leftover}("");
            // Do not revert if sender does not want to receive.
        }
    }

    /**
        @notice Function for depositing ETH, performing swap to defined tokens and bridging
            the tokens.
            msg.value should not only cover the swap for desired amount of tokens
            but it should also cover the bridging fee.
            It's equal to bridging fee + tokenSwapRate * amountOut
        @param destinationDomainID  ID of chain deposit will be bridged to.
        @param recipient Recipient of the deposit.
        @param token Output token to be deposited after swapping.
        @param amountOut Amount of tokens to be bridged.
        @param pathTokens Addresses of the tokens for Uniswap swap (in reverse order). WETH address is used for ETH.
        @param pathFees Fees for Uniswap pools (in reverse order).
    */
   function depositEthToTokens(
        uint8 destinationDomainID,
        address recipient,
        address token,
        uint256 amountOut,
        address[] calldata pathTokens,
        uint24[] calldata pathFees
    ) external payable {
        LocalVars memory vars;
        vars.resourceID = tokenToResourceID[token];
        if (vars.resourceID == bytes32(0)) revert TokenInvalid();

        // Compose depositData
        vars.depositDataAfterAmount = abi.encodePacked(
            uint256(20),
            recipient
        );
        if (msg.value == 0) revert InsufficientAmount(msg.value);
        vars.depositData = abi.encodePacked(
            amountOut,
            vars.depositDataAfterAmount
        );

        vars.feeHandlerRouter = _bridge._feeHandler();
        (vars.fee, ) = IFeeHandler(vars.feeHandlerRouter).calculateFee(
            address(this),
            _bridge._domainID(),
            destinationDomainID,
            vars.resourceID,
            vars.depositData,
            ""  // feeData - not parsed
        );

        if (msg.value < vars.fee) revert MsgValueLowerThanFee(msg.value);
        // Convert everything except the fee
        vars.swapAmount = msg.value - vars.fee;
        vars.amountIn = swapTokens(
            pathTokens,
            pathFees,
            _weth,
            token,
            vars.swapAmount,
            amountOut,
            vars.swapAmount
        );
        IPeripheryPayments(address(_swapRouter)).refundETH();

        vars.ERC20HandlerAddress = _bridge._resourceIDToHandlerAddress(vars.resourceID);
        IERC20(token).safeApprove(address(vars.ERC20HandlerAddress), amountOut);
        _bridge.deposit{value: vars.fee}(destinationDomainID, vars.resourceID, vars.depositData, "");

        // Return unspent native currency to msg.sender
        vars.leftover = address(this).balance;
        if (vars.leftover > 0) {
            payable(msg.sender).call{value: vars.leftover}("");
            // Do not revert if sender does not want to receive.
        }
    }

    /**
        @notice Function for depositing tokens, performing swap to ETH, bridging the ETH and executing
            a contract call on destination.
        @param destinationDomainID  ID of chain deposit will be bridged to.
        @param recipient Recipient of the deposit.
        @param gas The amount of gas needed to successfully execute the call to recipient on the destination. Fee amount is
                   directly affected by this value.
        @param message Arbitrary encoded bytes array that will be passed as the third argument in the
                       ISygmaMessageReceiver(recipient).handleSygmaMessage(_, _, message) call. If you intend to use the
                       DefaultMessageReceiver, make sure to encode the message to comply with the
                       DefaultMessageReceiver.handleSygmaMessage() message decoding implementation.
        @param token Input token to be swapped.
        @param amountInMax Max amount of input tokens to be swapped. It should exceed the desired
            amount of output tokens because the amount of swapped ETH should also cover the bridging fee.
            It's equal to tokenSwapRate * (amountOut + bridging fee)
        @param amountOut Amount of ETH to be bridged.
        @param pathTokens Addresses of the tokens for Uniswap swap (in reverse order). WETH address is used for ETH.
        @param pathFees Fees for Uniswap pools (in reverse order).
    */
    function depositTokensToEthWithMessage(
        uint8 destinationDomainID,
        address recipient,
        uint256 gas, 
        bytes memory message,
        address token,
        uint256 amountInMax,
        uint256 amountOut,
        address[] calldata pathTokens,
        uint24[] calldata pathFees
    ) external {
        LocalVars memory vars;
        vars.resourceID = tokenToResourceID[token];
        if (vars.resourceID == bytes32(0)) revert TokenInvalid();

        // Compose depositData
        vars.depositDataAfterAmount = abi.encodePacked(
            uint256(20),
            recipient,
            gas,
            uint256(message.length),
            message
        );

        vars.feeHandlerRouter = _bridge._feeHandler();
        (vars.fee, ) = IFeeHandler(vars.feeHandlerRouter).calculateFee(
            address(this),
            _bridge._domainID(),
            destinationDomainID,
            vars.resourceID,
            abi.encodePacked(amountOut, vars.depositDataAfterAmount),
            ""  // feeData - not parsed
        );

        vars.totalAmountOut = amountOut + vars.fee;

        // Swap tokens to ETH (exact output)
        IERC20(token).safeTransferFrom(msg.sender, address(this), amountInMax);
        IERC20(token).safeApprove(address(_swapRouter), amountInMax);

        vars.amountIn = swapTokens(
            pathTokens,
            pathFees,
            token,
            _weth,
            amountInMax,
            vars.totalAmountOut,
            0
        );

        IWETH(_weth).withdraw(vars.totalAmountOut);

        // Refund tokens
        if (vars.amountIn < amountInMax) {
            IERC20(token).safeApprove(address(_swapRouter), 0);
            IERC20(token).safeTransfer(msg.sender, amountInMax - vars.amountIn);
        }

        // Make Native Token deposit
        _nativeTokenAdapter.depositToEVMWithMessage{value: vars.totalAmountOut}(
            destinationDomainID,
            recipient,
            gas,
            message
        );

        // Return unspent native currency to msg.sender
        vars.leftover = address(this).balance;
        if (vars.leftover > 0) {
            payable(msg.sender).call{value: vars.leftover}("");
            // Do not revert if sender does not want to receive.
        }
    }

    /**
        @notice Function for depositing ETH, performing swap to defined tokens and bridging
            the tokens.
            msg.value should not only cover the swap for desired amount of tokens
            but it should also cover the bridging fee.
            It's equal to bridging fee + tokenSwapRate * amountOut
        @param destinationDomainID  ID of chain deposit will be bridged to.
        @param recipient Recipient of the deposit.
        @param gas The amount of gas needed to successfully execute the call to recipient on the destination. Fee amount is
                   directly affected by this value.
        @param message Arbitrary encoded bytes array that will be passed as the third argument in the
                       ISygmaMessageReceiver(recipient).handleSygmaMessage(_, _, message) call. If you intend to use the
                       DefaultMessageReceiver, make sure to encode the message to comply with the
                       DefaultMessageReceiver.handleSygmaMessage() message decoding implementation.
        @param token Output token to be deposited after swapping.
        @param amountOut Amount of tokens to be bridged.
        @param pathTokens Addresses of the tokens for Uniswap swap (in reverse order). WETH address is used for ETH.
        @param pathFees Fees for Uniswap pools (in reverse order).
    */
   function depositEthToTokensWithMessage(
        uint8 destinationDomainID,
        address recipient,
        uint256 gas, 
        bytes calldata message,
        address token,
        uint256 amountOut,
        address[] calldata pathTokens,
        uint24[] calldata pathFees
    ) external payable {
        LocalVars memory vars;
        vars.resourceID = tokenToResourceID[token];
        if (vars.resourceID == bytes32(0)) revert TokenInvalid();

        // Compose depositData
        vars.depositDataAfterAmount = abi.encodePacked(
            uint256(20),
            recipient,
            gas,
            uint256(message.length),
            message
        );
        if (msg.value == 0) revert InsufficientAmount(msg.value);
        vars.depositData = abi.encodePacked(
            amountOut,
            vars.depositDataAfterAmount
        );

        vars.feeHandlerRouter = _bridge._feeHandler();
        (vars.fee, ) = IFeeHandler(vars.feeHandlerRouter).calculateFee(
            address(this),
            _bridge._domainID(),
            destinationDomainID,
            vars.resourceID,
            vars.depositData,
            ""  // feeData - not parsed
        );

        if (msg.value < vars.fee) revert MsgValueLowerThanFee(msg.value);
        // Convert everything except the fee
        vars.swapAmount = msg.value - vars.fee;
        vars.amountIn = swapTokens(
            pathTokens,
            pathFees,
            _weth,
            token,
            vars.swapAmount,
            amountOut,
            vars.swapAmount
        );
        IPeripheryPayments(address(_swapRouter)).refundETH();

        vars.ERC20HandlerAddress = _bridge._resourceIDToHandlerAddress(vars.resourceID);
        IERC20(token).safeApprove(address(vars.ERC20HandlerAddress), amountOut);
        _bridge.deposit{value: vars.fee}(destinationDomainID, vars.resourceID, vars.depositData, "");

        // Return unspent native currency to msg.sender
        vars.leftover = address(this).balance;
        if (vars.leftover > 0) {
            payable(msg.sender).call{value: vars.leftover}("");
            // Do not revert if sender does not want to receive.
        }
    }

    function swapTokens(
        address[] calldata pathTokens,
        uint24[] calldata pathFees,
        address tokenIn,
        address tokenOut,
        uint256 amountInMaximum,
        uint256 amountOut,
        uint256 valueToSend
    ) internal returns(uint256 amountIn) {
        bytes memory path = _verifyAndEncodePath(
            pathTokens,
            pathFees,
            tokenIn,
            tokenOut
        );
        IV3SwapRouter.ExactOutputParams memory params = IV3SwapRouter.ExactOutputParams({
            path: path,
            recipient: address(this),
            amountOut: amountOut,
            amountInMaximum: amountInMaximum
        });

        amountIn = _swapRouter.exactOutput{value: valueToSend}(params);
        emit TokensSwapped(tokenIn, tokenOut, amountIn, amountOut);
    }

    function _verifyAndEncodePath(
        address[] calldata tokens,
        uint24[] calldata fees,
        address tokenIn,
        address tokenOut
    ) internal view returns (bytes memory path) {
        if (tokens.length != fees.length + 1) {
            revert PathInvalid();
        }

        tokenIn = tokenIn == address(0) ? address(_weth) : tokenIn;
        if (tokens[tokens.length - 1]  != tokenIn) revert PathInvalid();

        tokenOut = tokenOut == address(0) ? address(_weth) : tokenOut;
        if (tokens[0] != tokenOut) revert PathInvalid();

        for (uint256 i = 0; i < tokens.length - 1; i++){
            path = abi.encodePacked(path, tokens[i], fees[i]);
        }
        path = abi.encodePacked(path, tokens[tokens.length - 1]);
    }

    receive() external payable {}
}
