/**
 * MetalIOStub.m
 *
 * Provides weak stubs for Metal symbols that are referenced by Godot's
 * bundled metal-cpp library but not exported by the iOS Simulator's
 * Metal.framework. On real devices, these are all provided by Metal.framework
 * and these weak stubs are harmlessly overridden.
 */
#import <Foundation/Foundation.h>
#import <TargetConditionals.h>

#if TARGET_OS_SIMULATOR

// Error domains
NSString * const MTLIOErrorDomain       __attribute__((weak)) = @"MTLIOErrorDomain";
NSString * const MTLTensorDomain        __attribute__((weak)) = @"MTLTensorDomain";
NSString * const MTLBinaryArchiveDomain __attribute__((weak)) = @"MTLBinaryArchiveDomain";
NSString * const MTLCounterErrorDomain  __attribute__((weak)) = @"MTLCounterErrorDomain";
NSString * const MTLLogStateErrorDomain __attribute__((weak)) = @"MTLLogStateErrorDomain";

// Command buffer keys
NSString * const MTLCommandBufferEncoderInfoErrorKey __attribute__((weak)) = @"MTLCommandBufferEncoderInfoErrorKey";

// Common counter names
NSString * const MTLCommonCounterClipperInvocations                __attribute__((weak)) = @"MTLCommonCounterClipperInvocations";
NSString * const MTLCommonCounterClipperPrimitivesOut              __attribute__((weak)) = @"MTLCommonCounterClipperPrimitivesOut";
NSString * const MTLCommonCounterComputeKernelInvocations          __attribute__((weak)) = @"MTLCommonCounterComputeKernelInvocations";
NSString * const MTLCommonCounterFragmentCycles                    __attribute__((weak)) = @"MTLCommonCounterFragmentCycles";
NSString * const MTLCommonCounterFragmentInvocations               __attribute__((weak)) = @"MTLCommonCounterFragmentInvocations";
NSString * const MTLCommonCounterFragmentsPassed                   __attribute__((weak)) = @"MTLCommonCounterFragmentsPassed";
NSString * const MTLCommonCounterPostTessellationVertexCycles      __attribute__((weak)) = @"MTLCommonCounterPostTessellationVertexCycles";
NSString * const MTLCommonCounterPostTessellationVertexInvocations __attribute__((weak)) = @"MTLCommonCounterPostTessellationVertexInvocations";
NSString * const MTLCommonCounterRenderTargetWriteCycles           __attribute__((weak)) = @"MTLCommonCounterRenderTargetWriteCycles";
NSString * const MTLCommonCounterSetStageUtilization               __attribute__((weak)) = @"MTLCommonCounterSetStageUtilization";
NSString * const MTLCommonCounterSetStatistic                      __attribute__((weak)) = @"MTLCommonCounterSetStatistic";
NSString * const MTLCommonCounterSetTimestamp                      __attribute__((weak)) = @"MTLCommonCounterSetTimestamp";
NSString * const MTLCommonCounterTessellationCycles                __attribute__((weak)) = @"MTLCommonCounterTessellationCycles";
NSString * const MTLCommonCounterTessellationInputPatches          __attribute__((weak)) = @"MTLCommonCounterTessellationInputPatches";
NSString * const MTLCommonCounterTimestamp                         __attribute__((weak)) = @"MTLCommonCounterTimestamp";
NSString * const MTLCommonCounterTotalCycles                       __attribute__((weak)) = @"MTLCommonCounterTotalCycles";
NSString * const MTLCommonCounterVertexCycles                      __attribute__((weak)) = @"MTLCommonCounterVertexCycles";
NSString * const MTLCommonCounterVertexInvocations                 __attribute__((weak)) = @"MTLCommonCounterVertexInvocations";

#endif
