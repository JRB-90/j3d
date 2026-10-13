namespace J3D.Web;

/// <summary>
/// Cross-origin isolation (COOP + COEP) unlocks <c>SharedArrayBuffer</c>, which the multi-threaded
/// OCCT WebAssembly build and the worker progress channel depend on. Every resource the page loads
/// must therefore be same-origin or explicitly opt in via CORP/CORS — no third-party CDNs or fonts.
/// </summary>
public static class CrossOriginIsolation
{
    public const string OpenerPolicyHeader = "Cross-Origin-Opener-Policy";
    public const string EmbedderPolicyHeader = "Cross-Origin-Embedder-Policy";
    public const string OpenerPolicy = "same-origin";

    // Safari does not support "credentialless", so "require-corp" is the only portable value.
    public const string EmbedderPolicy = "require-corp";

    extension(IApplicationBuilder app)
    {
        public IApplicationBuilder UseCrossOriginIsolation() =>
            app.Use(static (context, next) =>
            {
                var headers = context.Response.Headers;
                headers[OpenerPolicyHeader] = OpenerPolicy;
                headers[EmbedderPolicyHeader] = EmbedderPolicy;
                return next(context);
            });
    }
}
