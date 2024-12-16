// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.11;

import "./interfaces/IBridge.sol";
import "./interfaces/IFeeHandler.sol";


contract NativeTokenTransferGateway {
    IBridge public immutable _bridge;
    bytes32 public immutable _resourceID;

    error SenderNotAdmin();
    error InsufficientMsgValueAmount(uint256 amount);
    error MsgValueLowerThanFee(uint256 amount);
    error InsufficientBalance();
    error FailedFundsTransfer();
    error ZeroGas();

    constructor(address bridge, bytes32 resourceID) {
        _bridge = IBridge(bridge);
        _resourceID = resourceID;
    }

    function deposit(uint8 destinationDomainID, string calldata recipientAddress) external payable {
        bytes memory depositData = abi.encodePacked(
            uint256(bytes(recipientAddress).length),
            recipientAddress
        );
        depositGeneral(destinationDomainID, depositData);
    }

    function depositToEVM(uint8 destinationDomainID, address recipient) external payable {
        bytes memory depositData = abi.encodePacked(
            uint256(20),
            recipient
        );
        depositGeneral(destinationDomainID, depositData);
    }

    /**
        @notice Makes a native token deposit with an included message.
        @param destinationDomainID ID of destination chain.
        @param recipient The destination chain contract address that implements the ISygmaMessageReceiver interface.
                         If the recipient is set to zero address then it will be replaced on the destination with
                         the address of the DefaultMessageReceiver which is a generic ISygmaMessageReceiver implementation.
        @param gas The amount of gas needed to successfully execute the call to recipient on the destination. Fee amount is
                   directly affected by this value.
        @param message Arbitrary encoded bytes array that will be passed as the third argument in the
                       ISygmaMessageReceiver(recipient).handleSygmaMessage(_, _, message) call. If you intend to use the
                       DefaultMessageReceiver, make sure to encode the message to comply with the
                       DefaultMessageReceiver.handleSygmaMessage() message decoding implementation.
     */
    function depositToEVMWithMessage(uint8 destinationDomainID, address recipient, uint256 gas, bytes calldata message) external payable {
        if (gas == 0) revert ZeroGas();
        bytes memory depositData = abi.encodePacked(
            uint256(20),
            recipient,
            gas,
            uint256(message.length),
            message
        );
        depositGeneral(destinationDomainID, depositData);
    }

    function depositGeneral(uint8 destinationDomainID, bytes memory depositDataAfterAmount) public payable {
        if (msg.value == 0) revert InsufficientMsgValueAmount(msg.value);
        address feeHandlerRouter = _bridge._feeHandler();
        (uint256 fee, ) = IFeeHandler(feeHandlerRouter).calculateFee(
            address(this),
            _bridge._domainID(),
            destinationDomainID,
            _resourceID,
            abi.encodePacked(msg.value, depositDataAfterAmount),
            ""  // feeData - not parsed
        );

        if (msg.value < fee) revert MsgValueLowerThanFee(msg.value);
        uint256 transferAmount = msg.value - fee;

        bytes memory depositData = abi.encodePacked(
            transferAmount,
            depositDataAfterAmount
        );

        _bridge.deposit{value: fee}(destinationDomainID, _resourceID, depositData, "");

        address nativeHandlerAddress = _bridge._resourceIDToHandlerAddress(_resourceID);
        (bool success, ) = nativeHandlerAddress.call{value: transferAmount}("");
        if (!success) revert FailedFundsTransfer();
        uint256 leftover = address(this).balance;
        if (leftover > 0) {
            (success, ) = payable(msg.sender).call{value: leftover}("");
            // Do not revert if sender does not want to receive.
        }
    }

    // For an unlikely case when part of the fee is returned.
    receive() external payable {}
}
