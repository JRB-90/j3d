/** The subset of Blazor's <c>DotNetObjectReference</c> that the app's scripts call back into. */
export interface DotNetObjectReference {
  invokeMethodAsync<T = void>(methodName: string, ...args: unknown[]): Promise<T>;
}
