import { parseAbi, parseAbiItem } from "viem";

/** Safe proxy factories, by `ProxyCreation` layout. */
export const factories130 = [
  "0xa6b71e26c5e0845f74c812102ca7114b6a896ab2", // v1.3.0
  "0xc22834581ebc8527d974f8a1c97e1bea4ef910bc", // v1.3.0 (eip155)
] as const;
export const factories141 = [
  "0x4e1dcf7ad4e460cfd30791ccc4f9c8a4f820ec67", // v1.4.1
  "0x14f2982d601c9458f93bd70b218933a6f8165e7b", // v1.5.0
] as const;

export const proxyCreation130 = parseAbiItem(
  "event ProxyCreation(address proxy, address singleton)",
);
export const proxyCreation141 = parseAbiItem(
  "event ProxyCreation(address indexed proxy, address singleton)",
);

/** Every Safe event, with the arguments not indexed (up to 1.3.0). */
export const safeAbi = parseAbi([
  "event SafeSetup(address indexed initiator, address[] owners, uint256 threshold, address initializer, address fallbackHandler)",
  "event SafeReceived(address indexed sender, uint256 value)",
  "event SafeModuleTransaction(address module, address to, uint256 value, bytes data, uint8 operation)",
  "event SafeMultiSigTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures, bytes additionalInfo)",
  "event ExecutionSuccess(bytes32 txHash, uint256 payment)",
  "event ExecutionFailure(bytes32 txHash, uint256 payment)",
  "event ChangedThreshold(uint256 threshold)",
  "event ChangedMasterCopy(address singleton)",
  "event ChangedFallbackHandler(address handler)",
  "event ChangedGuard(address guard)",
  "event ChangedModuleGuard(address indexed moduleGuard)",
  "event EnabledModule(address module)",
  "event DisabledModule(address module)",
  "event AddedOwner(address owner)",
  "event RemovedOwner(address owner)",
]);

/** The eight events whose argument became indexed in 1.4.x (same topic0). */
export const safeIndexedAbi = parseAbi([
  "event ExecutionSuccess(bytes32 indexed txHash, uint256 payment)",
  "event ExecutionFailure(bytes32 indexed txHash, uint256 payment)",
  "event ChangedFallbackHandler(address indexed handler)",
  "event ChangedGuard(address indexed guard)",
  "event EnabledModule(address indexed module)",
  "event DisabledModule(address indexed module)",
  "event AddedOwner(address indexed owner)",
  "event RemovedOwner(address indexed owner)",
]);
