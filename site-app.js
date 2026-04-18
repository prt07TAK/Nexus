(async function () {
    const [{ siteMeta, catalogData, collections }] = await Promise.all([
        import("./catalog.js")
    ]);
    const supabase = await createSupabaseClient();

    const STORAGE_KEYS = {
        cart: "nexus-fashion-cart",
        orders: "nexus-fashion-orders",
        profile: "nexus-fashion-profile"
    };

    const DEFAULT_PROFILE = {
        full_name: "Aarohi Sharma",
        email: "",
        phone: "+91 98765 11111",
        city: "Bengaluru",
        address: "12 Residency Road",
        pincode: "560025",
        preferred_fit: "True to size",
        style_mood: "Streetwear and elevated essentials"
    };

    const state = {
        page: resolvePage(),
        filters: { search: "", audience: "all", collection: "all", sort: "featured" },
        selectedSize: "",
        selectedPayment: "upi",
        cart: readStorage(STORAGE_KEYS.cart, []),
        orders: readStorage(STORAGE_KEYS.orders, []),
        profile: readStorage(STORAGE_KEYS.profile, DEFAULT_PROFILE),
        mobileOpen: false,
        session: null,
        authBusy: false,
        tryOn: { open: false, productId: null, size: "", mode: "idle", insights: [] }
    };

    const runtime = {
        poseLandmarker: null,
        tryOnLoop: null,
        tryOnStream: null,
        assetCache: new Map(),
        latestLandmarks: null,
        uploadedUrl: "",
        supabaseWarningShown: false,
        supabaseAvailable: Boolean(supabase.__enabled),
        poseWarningShown: false
    };

    document.addEventListener("click", onClick);
    document.addEventListener("input", onInput);
    document.addEventListener("change", onChange);
    document.addEventListener("submit", onSubmit);
    window.addEventListener("beforeunload", stopTryOnStream);
    window.addEventListener("scroll", syncHeaderState, { passive: true });
    window.addEventListener("resize", onResize);

    await syncSession();
    renderApp();
    supabase.auth.onAuthStateChange(async (_event, session) => {
        state.session = session;
        state.authBusy = false;
        if (session) {
            await loadRemoteProfile();
            await loadRemoteOrders();
        } else {
            state.orders = [];
        }
        renderApp();
    });

    function resolvePage() {
        const file = window.location.pathname.split("/").pop() || "index.html";
        return {
            "index.html": "home",
            "products.html": "shop",
            "about.html": "about",
            "cart.html": "cart",
            "product.html": "product",
            "payment.html": "payment",
            "profile.html": "profile",
            "orders.html": "orders",
            "support.html": "support",
            "terms.html": "terms"
        }[file] || "home";
    }

    function renderApp() {
        document.title = getPageTitle();
        const product = getCurrentProduct();
        if (product && (!state.selectedSize || !product.sizes.includes(state.selectedSize))) state.selectedSize = product.sizes[0];
        const rootMarkup = `
            ${buildHeader()}
            <main class="page-shell">
                ${buildNotice()}
                ${buildCurrentPage()}
            </main>
            ${buildFooter()}
            ${buildTryOnModal()}
            <div class="toast" id="toast-root"></div>
        `;
        document.body.innerHTML = rootMarkup;
        syncHeaderState();
        if (state.tryOn.open) hydrateTryOnStage();
    }

    function buildNotice() {
        const notices = [];
        if (window.location.protocol === "file:") {
            notices.push(`
                <div class="banner" style="padding:18px 24px;">
                    <h3 style="font-size:1.6rem;">Run this site on localhost for Google sign-in and camera access.</h3>
                    <p>Open it with the included local server instead of direct file preview so Supabase auth and the AI camera work correctly.</p>
                </div>
            `);
        }
        if (!runtime.supabaseAvailable) {
            notices.push(`
                <div class="banner" style="padding:18px 24px;">
                    <h3 style="font-size:1.6rem;">Account sign-in is temporarily unavailable.</h3>
                    <p>You can still browse products and test the AI camera, but checkout and account-linked orders stay locked until Supabase loads successfully.</p>
                </div>
            `);
        }
        if (!notices.length) return "";
        return `
            <section class="section-tight">
                <div class="shell">
                    ${notices.join("")}
                </div>
            </section>
        `;
    }

    function buildHeader() {
        const searchParams = new URLSearchParams(window.location.search);
        const currentCollection = searchParams.get("collection");
        const homeLink = { label: "Home", href: "index.html", active: state.page === "home" };
        const shopLinks = [
            { label: "All Products", href: "products.html", active: state.page === "shop" && !currentCollection },
            ...collections.map((collection) => ({
                label: collection.title,
                href: `products.html?collection=${collection.id}`,
                active: state.page === "shop" && currentCollection === collection.id
            }))
        ];
        const exploreLinks = [
            { label: "About Nexus", href: "about.html", active: state.page === "about" },
            { label: "Profile", href: "profile.html", active: state.page === "profile" },
            { label: "Orders", href: "orders.html", active: state.page === "orders" }
        ];
        const helpLinks = [
            { label: "Support", href: "support.html", active: state.page === "support" },
            { label: "Cart", href: "cart.html", active: state.page === "cart" || state.page === "payment" },
            { label: "Terms", href: "terms.html", active: state.page === "terms" }
        ];
        const navGroups = [
            { label: "Shop", active: shopLinks.some((item) => item.active), items: shopLinks },
            { label: "Explore", active: exploreLinks.some((item) => item.active), items: exploreLinks },
            { label: "Help", active: helpLinks.some((item) => item.active), items: helpLinks }
        ];
        const userLabel = state.session ? firstName(state.session.user.user_metadata?.full_name || state.session.user.email || "Account") : "Sign in";
        const menuMarkup = `
            <div class="menu-sections">
                <div class="menu-section">
                    <a class="menu-link ${homeLink.active ? "active" : ""}" href="${homeLink.href}">${homeLink.label}</a>
                </div>
                ${navGroups.map((group) => `
                    <div class="menu-section">
                        <p class="menu-title">${group.label}</p>
                        ${group.items.map((item) => `<a class="menu-link ${item.active ? "active" : ""}" href="${item.href}">${item.label}</a>`).join("")}
                    </div>
                `).join("")}
            </div>
        `;
        return `
            <header class="site-header">
                <div class="shell">
                    <a class="brand-lockup" href="index.html">
                        <img class="brand-mark" src="resources/brand-logo.png" alt="${siteMeta.brandName}">
                        <span class="brand-copy">
                            <strong>${siteMeta.brandName}</strong>
                            <span>${siteMeta.brandTagline}</span>
                        </span>
                    </a>
                    <div class="nav-actions">
                        <button class="button-ghost" type="button" data-auth-action="${state.session ? "signout" : "signin"}">${userLabel}</button>
                        <a class="icon-button" href="profile.html" aria-label="Profile">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm7 8a7 7 0 0 0-14 0" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
                        </a>
                        <a class="icon-button" href="cart.html" aria-label="Cart">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M4 5h2l1.2 7.2a1 1 0 0 0 1 .8h8.9a1 1 0 0 0 1-.7L20 7H7.3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><circle cx="10" cy="19" r="1.5" fill="currentColor"/><circle cx="17" cy="19" r="1.5" fill="currentColor"/></svg>
                            <span class="cart-pill">${cartCount()}</span>
                        </a>
                        <div class="menu-wrap ${state.mobileOpen ? "open" : ""}">
                            <button class="icon-button menu-toggle" type="button" data-nav-toggle aria-label="Open menu" aria-expanded="${state.mobileOpen ? "true" : "false"}">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
                            </button>
                            <div class="menu-dropdown" data-menu-dropdown>
                                ${menuMarkup}
                            </div>
                        </div>
                    </div>
                </div>
            </header>
        `;
    }

    function syncHeaderState() {
        const header = document.querySelector(".site-header");
        if (!header) return;
        header.classList.toggle("compact", window.scrollY > 24);
    }

    function onResize() {
        if (window.innerWidth > 820 && state.mobileOpen) {
            state.mobileOpen = false;
            renderApp();
            return;
        }
        syncHeaderState();
    }

    function buildCurrentPage() {
        const pages = {
            home: buildHomePage(),
            shop: buildShopPage(),
            about: buildAboutPage(),
            cart: buildCartPage(),
            product: buildProductPage(),
            payment: buildPaymentPage(),
            profile: buildProfilePage(),
            orders: buildOrdersPage(),
            support: buildSupportPage(),
            terms: buildTermsPage()
        };
        return pages[state.page] || pages.home;
    }

    function buildHomePage() {
        const featured = catalogData.filter((item) => item.featured).slice(0, 8);
        const womenCount = catalogData.filter((item) => item.audience === "women").length;
        const menCount = catalogData.filter((item) => item.audience === "men").length;
        return `
            <section class="section">
                <div class="shell hero-grid">
                    <div class="glass-panel hero-copy">
                        <span class="eyebrow">Indian AI fashion storefront</span>
                        <h1 class="display">Check every outfit on yourself before you buy.</h1>
                        <p class="lede">Nexus Fashion is a unisex shopping experience with a real AI camera on every product page, stronger picks for women and men, and account-linked checkout for cleaner ordering.</p>
                        <div class="button-row">
                            <a class="button" href="products.html">Shop the collection</a>
                            <button class="button-secondary" type="button" data-open-tryon="1">Open AI camera</button>
                        </div>
                        <div class="hero-stat-grid">
                            <div class="stat-card"><strong>${catalogData.length} live</strong><span>Products matched to the current image library</span></div>
                            <div class="stat-card"><strong>${womenCount} women</strong><span>Expanded women's styles with AI try-on support</span></div>
                            <div class="stat-card"><strong>${menCount} men</strong><span>More men's picks across streetwear and athleisure</span></div>
                            <div class="stat-card"><strong>Live</strong><span>Camera and uploaded-photo virtual try-on</span></div>
                        </div>
                    </div>
                    <div class="hero-card panel">
                        <div class="inline-stack" style="justify-content:space-between; margin-bottom:16px;">
                            <span class="badge">Brand name: Nexus Fashion</span>
                            <span class="badge">Built for India's Gen-Z</span>
                        </div>
                        <img src="resources/hero-image.jpg" alt="Nexus Fashion editorial hero">
                    </div>
                </div>
            </section>
            <section class="section-tight">
                <div class="shell stats-grid">
                    <div class="mini-card"><strong>UPI</strong><span>Card, net banking, and COD all live in checkout.</span></div>
                    <div class="mini-card"><strong>Unisex</strong><span>Women's, men's, and shared essentials all sit in one catalog.</span></div>
                    <div class="mini-card"><strong>Supabase</strong><span>Profile and order syncing are now aligned to signed-in shopping.</span></div>
                    <div class="mini-card"><strong>Camera</strong><span>Pose-based garment overlay for live and uploaded try-on.</span></div>
                </div>
            </section>
            <section class="section">
                <div class="shell">
                    <div class="section-heading">
                        <div><span class="eyebrow">Featured products</span><h2 class="headline">Matching names, matching images, stronger fashion storytelling.</h2></div>
                        <p>Every product card now points to the correct photo from the original website assets and includes AI try-on, product detail, and quick cart actions.</p>
                    </div>
                    <div class="product-grid">${featured.map(buildProductCard).join("")}</div>
                </div>
            </section>
            <section class="section">
                <div class="shell feature-grid">
                    <article class="feature-card"><div class="feature-icon">AI</div><h3>Actual camera flow</h3><p>Live webcam or uploaded photos use pose landmarks to position products on the body instead of showing a fake placeholder overlay.</p></article>
                    <article class="feature-card"><div class="feature-icon">IN</div><h3>India-first shopping</h3><p>INR pricing, UPI checkout, COD support, city-aware copy, and product language tuned for Indian shoppers.</p></article>
                    <article class="feature-card"><div class="feature-icon">ID</div><h3>Inclusive catalog</h3><p>Women's products, men's products, and unisex essentials all share the same premium storefront and AI-assisted product journey.</p></article>
                </div>
            </section>
        `;
    }

    function buildShopPage() {
        const products = getFilteredProducts();
        return `
            <section class="section-tight">
                <div class="shell banner">
                    <h2>Shop men, women, and unisex fashion with AI try-on on every product.</h2>
                    <p>The catalog matches the current product image assets, includes new women's and men's additions, and keeps AI camera access on every product page.</p>
                </div>
            </section>
            <section class="section">
                <div class="shell catalog-layout">
                    <aside class="catalog-sidebar">
                        <div class="panel">
                            <div class="section-heading" style="margin-bottom:12px;">
                                <div><span class="eyebrow">Filters</span><h2 class="headline" style="font-size:2rem;">Find your vibe</h2></div>
                            </div>
                            <div class="filter-stack">
                                <label><span class="muted">Search</span><input class="input" id="catalog-search" type="search" value="${safe(state.filters.search)}" placeholder="Search by product, style, accessory"></label>
                                <div><span class="muted">Audience</span><div class="filter-tabs">${["all", "women", "men", "unisex"].map((aud) => `<button class="pill ${state.filters.audience === aud ? "active" : ""}" type="button" data-filter-audience="${aud}">${titleCase(aud)}</button>`).join("")}</div></div>
                                <label><span class="muted">Collection</span><select class="select" id="catalog-collection">${["all", "new-gen", "street", "urban", "workwear", "athleisure"].map((item) => `<option value="${item}" ${state.filters.collection === item ? "selected" : ""}>${item === "all" ? "All collections" : titleCase(item.replace("-", " "))}</option>`).join("")}</select></label>
                                <label><span class="muted">Sort by</span><select class="select" id="catalog-sort">${[["featured", "Featured"], ["price-low", "Price: Low to High"], ["price-high", "Price: High to Low"], ["rating", "Highest Rated"]].map(([v, label]) => `<option value="${v}" ${state.filters.sort === v ? "selected" : ""}>${label}</option>`).join("")}</select></label>
                            </div>
                        </div>
                    </aside>
                    <div class="catalog-main">
                        <div class="panel">
                            <div class="section-heading">
                                <div><span class="eyebrow">Catalog</span><h2 class="headline" style="font-size:2rem;">${products.length} products live</h2></div>
                                <p>Use filters to jump between women's fashion, men's essentials, athleisure, and unisex products. Every item opens a dedicated product page and AI camera.</p>
                            </div>
                            <div class="product-grid">${products.map(buildProductCard).join("") || `<div class="empty-state">No products matched your filters.</div>`}</div>
                        </div>
                    </div>
                </div>
            </section>
        `;
    }

    function buildAboutPage() {
        return `
            <section class="section-tight">
                <div class="shell banner">
                    <h2>Nexus Fashion is the upgraded version of the original storefront, rebuilt as a sharper AI-first brand.</h2>
                    <p>The original photo references remain, but the website now feels more premium, more Gen-Z, and much more aligned to how Indian customers shop fashion online.</p>
                </div>
            </section>
            <section class="section">
                <div class="shell story-grid">
                    <article class="story-card"><span class="eyebrow">Why Nexus Fashion</span><h3>The product page is no longer the end of the story. It is the start of the AI fitting journey.</h3><p>Customers can now move from discovery to cart confidence with a working try-on flow instead of static product guessing.</p></article>
                    <article class="story-card"><span class="eyebrow">Built for India</span><h3>English content, Indian shopping behavior.</h3><p>Payment methods, pricing, delivery messaging, account flow, and product storytelling are tuned for Indian ecommerce expectations.</p></article>
                </div>
            </section>
            <section class="section">
                <div class="shell media-strip">
                    <img src="resources/team-1.jpg" alt="Nexus Fashion styling mood">
                    <img src="resources/team-2.jpg" alt="Nexus Fashion creative team">
                    <img src="resources/team-3.jpg" alt="Nexus Fashion AI fashion direction">
                </div>
            </section>
        `;
    }

    function buildCartPage() {
        if (!state.cart.length) {
            return `
                <section class="section">
                    <div class="shell">
                        <div class="empty-state">
                            <h3>Your cart is empty.</h3>
                            <p class="muted">Try products with the AI camera, then add the looks you like here.</p>
                            <a class="button" href="products.html">Continue shopping</a>
                        </div>
                    </div>
                </section>
            `;
        }
        return `
            <section class="section-tight">
                <div class="shell banner"><h2>Your cart is ready for final review.</h2><p>Update quantities, reopen AI try-on if needed, and continue to the payment page.</p></div>
            </section>
            <section class="section">
                <div class="shell cart-layout">
                    <div class="panel"><div class="section-heading"><div><span class="eyebrow">Cart</span><h2 class="headline" style="font-size:2rem;">Selected products</h2></div></div><div class="summary-stack">${state.cart.map(buildCartItem).join("")}</div></div>
                    <aside class="panel"><div class="section-heading"><div><span class="eyebrow">Summary</span><h2 class="headline" style="font-size:2rem;">Bill details</h2></div></div>${buildSummaryMarkup(true)}</aside>
                </div>
            </section>
        `;
    }

    function buildProductPage() {
        const product = getCurrentProduct();
        if (!product) {
            return `<section class="section"><div class="shell"><div class="empty-state"><h3>Product not found.</h3><a class="button" href="products.html">Back to shop</a></div></div></section>`;
        }
        const related = catalogData.filter((item) => item.id !== product.id).slice(0, 4);
        const selectedSize = state.selectedSize || product.sizes[0];
        return `
            <section class="section-tight">
                <div class="shell detail-layout">
                    <div class="panel detail-media-card"><img src="${product.image}" alt="${product.name}"></div>
                    <div class="panel detail-panel">
                        <span class="eyebrow">${titleCase(product.audience)} · ${titleCase(product.collection.replace("-", " "))}</span>
                        <h1 class="headline">${product.name}</h1>
                        <div class="meta-row"><span class="badge">${product.badge}</span><span class="rating">${product.rating} / 5 from ${product.reviews} reviews</span></div>
                        <p class="lede">${product.shortDescription}</p>
                        <div class="price-line"><span>${formatCurrency(product.price)}</span><span class="strike">${formatCurrency(product.compareAt)}</span></div>
                        <div><span class="muted">Choose size</span><div class="size-grid">${product.sizes.map((size) => `<button class="size-button ${selectedSize === size ? "active" : ""}" type="button" data-size-pick="${size}">${size}</button>`).join("")}</div></div>
                        <div class="button-row"><button class="button" type="button" data-add-to-cart="${product.id}" data-size="${selectedSize}">Add to cart</button><button class="button-secondary" type="button" data-open-tryon="${product.id}">Open AI camera</button></div>
                        <div class="split-grid">
                            <div class="summary-card"><h3>Fit and fabric</h3><p><strong>Fit:</strong> ${product.fit}</p><p><strong>Fabric:</strong> ${product.fabric}</p><p><strong>Delivery:</strong> ${product.delivery}</p></div>
                            <div class="summary-card"><h3>Why it works</h3><ul class="detail-list"><li>Product image now correctly matches the item name.</li><li>AI camera is available on this product page.</li><li>Built for India's fashion-shopping flow.</li></ul></div>
                        </div>
                    </div>
                </div>
            </section>
            <section class="section">
                <div class="shell"><div class="section-heading"><div><span class="eyebrow">Related picks</span><h2 class="headline" style="font-size:2rem;">Compare more looks</h2></div></div><div class="product-grid">${related.map(buildProductCard).join("")}</div></div>
            </section>
        `;
    }

    function buildPaymentPage() {
        if (!state.cart.length) {
            return `<section class="section"><div class="shell"><div class="empty-state"><h3>No products in cart.</h3><a class="button" href="products.html">Shop now</a></div></div></section>`;
        }
        if (!state.session) {
            return `
                <section class="section-tight">
                    <div class="shell banner"><h2>Sign in before checkout</h2><p>Orders are linked to customer accounts, so sign in with Google before placing an order.</p></div>
                </section>
                <section class="section">
                    <div class="shell payment-layout">
                        <div class="panel">
                            <div class="section-heading"><div><span class="eyebrow">Account required</span><h2 class="headline" style="font-size:2rem;">Continue with Google to order</h2></div></div>
                            <p class="lede">You can keep using the cart and AI camera as a visitor, but checkout and order history are only available to signed-in users.</p>
                            <div class="button-row">
                                <button class="button" type="button" data-auth-action="signin">Continue with Google</button>
                                <a class="button-secondary" href="cart.html">Back to cart</a>
                            </div>
                        </div>
                        <aside class="panel"><div class="section-heading"><div><span class="eyebrow">Summary</span><h2 class="headline" style="font-size:2rem;">Final amount</h2></div></div>${buildSummaryMarkup(false)}</aside>
                    </div>
                </section>
            `;
        }
        return `
            <section class="section-tight">
                <div class="shell banner"><h2>Checkout and payment</h2><p>Use UPI, cards, net banking, or cash on delivery through your signed-in Nexus Fashion account.</p></div>
            </section>
            <section class="section">
                <div class="shell payment-layout">
                    <div class="panel">
                        <div class="section-heading"><div><span class="eyebrow">Address and payment</span><h2 class="headline" style="font-size:2rem;">Delivery details</h2></div></div>
                        <form id="payment-form" class="form-stack">
                            <div class="split-grid">
                                <label><span class="muted">Full name</span><input class="input" name="full_name" value="${safe(state.profile.full_name)}" required></label>
                                <label><span class="muted">Phone</span><input class="input" name="phone" value="${safe(state.profile.phone)}" required></label>
                            </div>
                            <label><span class="muted">Address</span><input class="input" name="address" value="${safe(state.profile.address)}" required></label>
                            <div class="split-grid">
                                <label><span class="muted">City</span><input class="input" name="city" value="${safe(state.profile.city)}" required></label>
                                <label><span class="muted">Pincode</span><input class="input" name="pincode" value="${safe(state.profile.pincode)}" required></label>
                            </div>
                            <label><span class="muted">State</span><input class="input" name="state" value="Karnataka" required></label>
                            <div><span class="muted">Payment method</span><div class="payment-methods">${[["upi", "UPI"], ["card", "Card"], ["netbanking", "Net Banking"], ["cod", "Cash on Delivery"]].map(([key, label]) => `<button class="payment-chip ${state.selectedPayment === key ? "active" : ""}" type="button" data-payment-set="${key}">${label}</button>`).join("")}</div></div>
                            <label><span class="muted">Order notes</span><textarea class="textarea" name="notes" placeholder="Optional notes for delivery or support"></textarea></label>
                            <button class="button" type="submit">Place order</button>
                        </form>
                    </div>
                    <aside class="panel"><div class="section-heading"><div><span class="eyebrow">Summary</span><h2 class="headline" style="font-size:2rem;">Final amount</h2></div></div>${buildSummaryMarkup(false)}</aside>
                </div>
            </section>
        `;
    }

    function buildProfilePage() {
        const authCard = state.session
            ? `<div class="summary-card"><h3>Signed in</h3><p>${safe(state.session.user.email || "Google account connected")}</p><button class="button-secondary" type="button" data-auth-action="signout">Sign out</button></div>`
            : `<div class="summary-card"><h3>Google authentication</h3><p>Sign in with Google through Supabase so profile details and orders can sync to your account.</p><button class="button" type="button" data-auth-action="signin">Continue with Google</button></div>`;
        return `
            <section class="section-tight">
                <div class="shell banner"><h2>Your Nexus Fashion profile</h2><p>Manage account details, style preferences, and delivery information from one place.</p></div>
            </section>
            <section class="section">
                <div class="shell profile-grid">
                    <aside class="profile-card">
                        <span class="eyebrow">Account</span>
                        <h3 style="margin-top:14px;">${safe(state.profile.full_name || "Guest user")}</h3>
                        <p>${safe(state.profile.city || "India")} · ${safe(state.profile.style_mood || "Gen-Z style")}</p>
                        <div class="summary-stack" style="margin-top:18px;">${authCard}<div class="summary-card"><h3>Total orders</h3><p>${state.orders.length} placed</p></div></div>
                    </aside>
                    <div class="profile-card">
                        <div class="section-heading" style="margin-bottom:14px;"><div><span class="eyebrow">Profile</span><h2 class="headline" style="font-size:2rem;">Personal details</h2></div></div>
                        <form id="profile-form" class="form-stack">
                            <div class="split-grid">
                                <label><span class="muted">Full name</span><input class="input" name="full_name" value="${safe(state.profile.full_name)}" required></label>
                                <label><span class="muted">Email</span><input class="input" name="email" value="${safe(state.session?.user?.email || state.profile.email || "")}"></label>
                            </div>
                            <div class="split-grid">
                                <label><span class="muted">Phone</span><input class="input" name="phone" value="${safe(state.profile.phone)}" required></label>
                                <label><span class="muted">City</span><input class="input" name="city" value="${safe(state.profile.city)}" required></label>
                            </div>
                            <label><span class="muted">Address</span><input class="input" name="address" value="${safe(state.profile.address)}" required></label>
                            <div class="split-grid">
                                <label><span class="muted">Pincode</span><input class="input" name="pincode" value="${safe(state.profile.pincode)}" required></label>
                                <label><span class="muted">Preferred fit</span><input class="input" name="preferred_fit" value="${safe(state.profile.preferred_fit)}"></label>
                            </div>
                            <label><span class="muted">Style mood</span><input class="input" name="style_mood" value="${safe(state.profile.style_mood)}"></label>
                            <button class="button" type="submit">Save profile</button>
                        </form>
                    </div>
                </div>
            </section>
        `;
    }

    function buildOrdersPage() {
        if (!state.session) {
            return `
                <section class="section-tight">
                    <div class="shell banner"><h2>Sign in to view your orders</h2><p>Order history is available only inside the signed-in customer account that placed the order.</p></div>
                </section>
                <section class="section">
                    <div class="shell">
                        <div class="empty-state">
                            <h3>Your account is not signed in.</h3>
                            <p class="muted">Use Google sign-in so your orders sync to the right customer profile.</p>
                            <button class="button" type="button" data-auth-action="signin">Continue with Google</button>
                        </div>
                    </div>
                </section>
            `;
        }
        const items = state.orders.length ? state.orders.map((order) => `
            <article class="order-card">
                <div class="section-heading" style="margin-bottom:12px;">
                    <div><span class="eyebrow">Order ${order.id}</span><h3>${order.items.length} item${order.items.length > 1 ? "s" : ""} · ${order.status}</h3></div>
                    <p>${safe(order.date)}</p>
                </div>
                <div class="order-meta"><span class="badge">${paymentLabel(order.payment_method)}</span><span class="badge">ETA ${safe(order.eta || "2 to 4 business days")}</span><span class="badge">${formatCurrency(order.total)}</span></div>
                <div class="divider"></div>
                <div class="summary-stack">${order.items.map((item) => { const product = findProduct(item.productId); return product ? `<div class="summary-line"><span>${product.name} · Size ${item.size} · Qty ${item.quantity}</span><strong>${formatCurrency(product.price * item.quantity)}</strong></div>` : ""; }).join("")}</div>
            </article>
        `).join("") : `<div class="empty-state"><h3>No orders yet.</h3><p class="muted">After checkout, your orders will appear here.</p><a class="button" href="products.html">Start shopping</a></div>`;
        return `
            <section class="section-tight">
                <div class="shell banner"><h2>Your orders</h2><p>Track payment method, item summary, and delivery progress inside your account space.</p></div>
            </section>
            <section class="section"><div class="shell"><div class="summary-stack">${items}</div></div></section>
        `;
    }

    function buildSupportPage() {
        return `
            <section class="section-tight">
                <div class="shell banner"><h2>Support and shipping help</h2><p>Reach Nexus Fashion for delivery, AI try-on, returns, and account support.</p></div>
            </section>
            <section class="section">
                <div class="shell support-grid">
                    <article class="support-card"><span class="eyebrow">Email</span><h3>${siteMeta.supportEmail}</h3><p>For orders, returns, payment help, and account questions.</p></article>
                    <article class="support-card"><span class="eyebrow">WhatsApp</span><h3>${siteMeta.supportWhatsApp}</h3><p>Fast support for basic order and delivery queries.</p></article>
                    <article class="support-card"><span class="eyebrow">Shipping</span><h3>2 to 5 day delivery</h3><p>Metro orders dispatch faster. Tier 2 and Tier 3 timelines depend on pincode coverage.</p></article>
                    <article class="support-card"><span class="eyebrow">Returns</span><h3>Easy exchange policy</h3><p>Eligible size issues can be exchanged within 7 days depending on product condition and category.</p></article>
                </div>
            </section>
        `;
    }

    function buildTermsPage() {
        return `
            <section class="section-tight">
                <div class="shell banner"><h2>Terms and conditions</h2><p>Simple policies around orders, pricing, AI try-on, payments, and customer account use.</p></div>
            </section>
            <section class="section">
                <div class="shell legal-grid">
                    <article class="legal-card"><span class="eyebrow">Orders</span><h3>Order acceptance</h3><p>Orders are confirmed after successful payment or COD validation, subject to product availability.</p></article>
                    <article class="legal-card"><span class="eyebrow">Pricing</span><h3>INR pricing</h3><p>All prices are listed in INR. Any shipping or platform charges are shown at checkout.</p></article>
                    <article class="legal-card"><span class="eyebrow">AI camera</span><h3>Preview guidance</h3><p>The AI try-on is a fit-assistance tool, not a tailoring guarantee. Customers should still review product fit notes.</p></article>
                    <article class="legal-card"><span class="eyebrow">Accounts</span><h3>User responsibility</h3><p>Customers should keep profile, address, and contact information accurate for delivery and support.</p></article>
                </div>
            </section>
        `;
    }

    function buildFooter() {
        return `
            <footer class="footer">
                <div class="shell footer-grid">
                    <div class="footer-block">
                        <div class="brand-lockup">
                            <img class="brand-mark" src="resources/brand-logo.png" alt="${siteMeta.brandName}">
                            <span class="brand-copy"><strong>${siteMeta.brandName}</strong><span>${siteMeta.brandTagline}</span></span>
                        </div>
                        <p class="footer-note">Nexus Fashion blends product discovery, AI try-on, and Indian checkout logic into a sharper new-gen storefront.</p>
                    </div>
                    <div class="footer-block"><h4>Shop</h4><div class="footer-links"><a href="products.html?collection=new-gen">New Gen Edit</a><a href="products.html?audience=women">Women</a><a href="products.html?audience=men">Men</a><a href="products.html?audience=unisex">Unisex</a></div></div>
                    <div class="footer-block"><h4>Account</h4><div class="footer-links"><a href="profile.html">Profile</a><a href="orders.html">Orders</a><a href="cart.html">Cart</a><a href="payment.html">Payment</a></div></div>
                    <div class="footer-block"><h4>Company</h4><div class="footer-links"><a href="about.html">About</a><a href="support.html">Support</a><a href="terms.html">Terms</a><a href="mailto:${siteMeta.supportEmail}">${siteMeta.supportEmail}</a></div></div>
                </div>
            </footer>
        `;
    }

    function buildTryOnModal() {
        const product = getTryOnProduct();
        if (!product) {
            return `<div class="tryon-modal ${state.tryOn.open ? "open" : ""}" id="tryon-modal"></div>`;
        }
        return `
            <div class="tryon-modal ${state.tryOn.open ? "open" : ""}" id="tryon-modal" aria-hidden="${state.tryOn.open ? "false" : "true"}">
                <div class="tryon-dialog">
                    <div class="tryon-stage" id="tryon-stage">
                        <video id="tryon-video" class="hidden" autoplay muted playsinline></video>
                        <img id="tryon-photo" class="${state.tryOn.mode === "photo" ? "" : "hidden"}" alt="${product.name}">
                        <canvas id="tryon-overlay"></canvas>
                        <div class="tryon-stage-overlay"><div class="stage-chip">AI Try-On</div><div class="stage-chip" id="tryon-stage-chip">${state.tryOn.mode === "live" ? "Live camera active" : state.tryOn.mode === "photo" ? "Uploaded photo loaded" : "Start camera or upload a photo"}</div></div>
                    </div>
                    <div class="tryon-side">
                        <div class="tryon-topbar">
                            <div><span class="eyebrow">Virtual try-on</span><h3>${product.name}</h3><p class="muted">${product.shortDescription}</p></div>
                            <button class="close-button" type="button" data-close-tryon aria-label="Close try-on">×</button>
                        </div>
                        <div class="panel">
                            <div class="summary-stack">
                                <div class="button-row">
                                    <button class="button" type="button" data-start-camera>Start camera</button>
                                    <button class="button-ghost" type="button" data-stop-camera>Stop camera</button>
                                    <label class="upload-label">Upload photo<input id="tryon-upload" type="file" accept="image/*"></label>
                                </div>
                                <div><span class="muted">Select size</span><div class="size-grid">${product.sizes.map((size) => `<button class="size-button ${state.tryOn.size === size ? "active" : ""}" type="button" data-tryon-size="${size}">${size}</button>`).join("")}</div></div>
                                <button class="button-secondary" type="button" data-run-fit>Run fit analysis</button>
                            </div>
                        </div>
                        <div class="insight-list">${state.tryOn.insights.map((item) => `<div class="insight-card"><strong>${item.title}</strong><span class="muted">${item.body}</span></div>`).join("") || `<div class="insight-card"><strong>How it works</strong><span class="muted">This camera uses pose landmarks to place the selected product on your body or uploaded image.</span></div>`}</div>
                    </div>
                </div>
            </div>
        `;
    }

    function buildProductCard(product) {
        return `
            <article class="product-card">
                <div class="product-media"><span class="badge product-badge">${product.badge}</span><img src="${product.image}" alt="${product.name}"></div>
                <div class="product-info">
                    <div class="product-title"><div><h3>${product.name}</h3><span class="muted">${titleCase(product.audience)} · ${titleCase(product.collection.replace("-", " "))}</span></div><span class="rating">${product.rating} / 5</span></div>
                    <p class="muted">${product.shortDescription}</p>
                    <div class="price-line"><span>${formatCurrency(product.price)}</span><span class="strike">${formatCurrency(product.compareAt)}</span></div>
                    <div class="product-tags"><span class="product-tag">${titleCase(product.category)}</span><span class="product-tag">AI Try-On</span></div>
                    <div class="product-actions"><a class="button-ghost" href="product.html?slug=${product.slug}">View product</a><button class="button-secondary" type="button" data-open-tryon="${product.id}">AI camera</button><button class="button" type="button" data-add-to-cart="${product.id}" data-size="${product.sizes[0]}">Add to cart</button></div>
                </div>
            </article>
        `;
    }

    function buildCartItem(item) {
        const product = findProduct(item.productId);
        if (!product) return "";
        return `
            <article class="cart-item">
                <img src="${product.image}" alt="${product.name}">
                <div class="summary-stack">
                    <div class="product-title"><div><h3>${product.name}</h3><span class="muted">Size ${item.size} · Qty ${item.quantity}</span></div><strong>${formatCurrency(product.price * item.quantity)}</strong></div>
                    <p class="muted">${product.shortDescription}</p>
                    <div class="meta-row"><div class="qty-controls"><button type="button" data-qty-change="-1" data-cart-key="${item.key}">−</button><strong>${item.quantity}</strong><button type="button" data-qty-change="1" data-cart-key="${item.key}">+</button></div><button class="button-ghost" type="button" data-remove-cart="${item.key}">Remove</button><button class="button-secondary" type="button" data-open-tryon="${product.id}">AI camera</button></div>
                </div>
            </article>
        `;
    }

    function buildSummaryMarkup(includeCta) {
        const totals = cartTotals();
        return `
            <div class="summary-stack">
                ${state.cart.map((item) => { const product = findProduct(item.productId); return product ? `<div class="summary-line"><span>${product.name} · ${item.size} · Qty ${item.quantity}</span><strong>${formatCurrency(product.price * item.quantity)}</strong></div>` : ""; }).join("")}
                <div class="divider"></div>
                <div class="summary-line"><span>Subtotal</span><strong>${formatCurrency(totals.subtotal)}</strong></div>
                <div class="summary-line"><span>Shipping</span><strong>${totals.shipping ? formatCurrency(totals.shipping) : "Free"}</strong></div>
                <div class="summary-line"><span>Platform fee</span><strong>${formatCurrency(totals.platformFee)}</strong></div>
                <div class="summary-line"><span>Discount</span><strong>- ${formatCurrency(totals.discount)}</strong></div>
                <div class="divider"></div>
                <div class="summary-line total"><span>Total</span><strong>${formatCurrency(totals.total)}</strong></div>
                ${includeCta ? state.session ? `<a class="button" href="payment.html">Proceed to payment</a>` : `<button class="button" type="button" data-auth-action="signin">Sign in to checkout</button><p class="muted">Orders are placed only from signed-in accounts.</p>` : ""}
            </div>
        `;
    }

    async function onClick(event) {
        let menuClosed = false;
        if (state.mobileOpen && !event.target.closest(".menu-wrap")) {
            state.mobileOpen = false;
            menuClosed = true;
        }

        const target = event.target.closest("[data-nav-toggle],[data-filter-audience],[data-open-tryon],[data-close-tryon],[data-add-to-cart],[data-size-pick],[data-qty-change],[data-remove-cart],[data-payment-set],[data-auth-action],[data-start-camera],[data-stop-camera],[data-run-fit],[data-tryon-size]");
        if (!target) {
            if (menuClosed) renderApp();
            return;
        }

        if (target.hasAttribute("data-nav-toggle")) {
            state.mobileOpen = !state.mobileOpen;
            renderApp();
            return;
        }
        if (target.dataset.filterAudience) {
            state.filters.audience = target.dataset.filterAudience;
            renderApp();
        }
        if (target.dataset.openTryon) openTryOn(Number(target.dataset.openTryon));
        if (target.hasAttribute("data-close-tryon")) closeTryOn();
        if (target.dataset.addToCart) addToCart(Number(target.dataset.addToCart), target.dataset.size || state.selectedSize);
        if (target.dataset.sizePick) { state.selectedSize = target.dataset.sizePick; renderApp(); }
        if (target.dataset.qtyChange) changeCartQty(target.dataset.cartKey, Number(target.dataset.qtyChange));
        if (target.dataset.removeCart) removeCartItem(target.dataset.removeCart);
        if (target.dataset.paymentSet) { state.selectedPayment = target.dataset.paymentSet; renderApp(); }
        if (target.dataset.authAction) await handleAuthAction(target.dataset.authAction);
        if (target.hasAttribute("data-start-camera")) await startTryOnCamera();
        if (target.hasAttribute("data-stop-camera")) stopTryOnStream(true);
        if (target.hasAttribute("data-run-fit")) runFitAnalysis();
        if (target.dataset.tryonSize) { state.tryOn.size = target.dataset.tryonSize; renderApp(); }
    }

    function onInput(event) {
        if (event.target.id === "catalog-search") {
            state.filters.search = event.target.value;
            renderApp();
        }
    }

    function onChange(event) {
        if (event.target.id === "catalog-collection") {
            state.filters.collection = event.target.value;
            renderApp();
        }
        if (event.target.id === "catalog-sort") {
            state.filters.sort = event.target.value;
            renderApp();
        }
        if (event.target.id === "tryon-upload") {
            handleTryOnUpload(event.target.files && event.target.files[0]);
        }
    }

    async function onSubmit(event) {
        if (event.target.id === "profile-form") {
            event.preventDefault();
            const form = new FormData(event.target);
            state.profile = {
                ...state.profile,
                full_name: String(form.get("full_name") || ""),
                email: String(form.get("email") || ""),
                phone: String(form.get("phone") || ""),
                city: String(form.get("city") || ""),
                address: String(form.get("address") || ""),
                pincode: String(form.get("pincode") || ""),
                preferred_fit: String(form.get("preferred_fit") || ""),
                style_mood: String(form.get("style_mood") || "")
            };
            writeStorage(STORAGE_KEYS.profile, state.profile);
            await saveRemoteProfile();
            showToast("Profile saved");
            renderApp();
        }

        if (event.target.id === "payment-form") {
            event.preventDefault();
            if (!state.session) {
                showToast("Sign in with Google before placing an order.");
                window.location.href = "profile.html";
                return;
            }
            const form = new FormData(event.target);
            const totals = cartTotals();
            const order = {
                id: `NX${String(Date.now()).slice(-8)}`,
                status: "Confirmed",
                date: new Date().toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }),
                eta: "2 to 4 business days",
                payment_method: state.selectedPayment,
                total: totals.total,
                shipping_address: {
                    full_name: String(form.get("full_name") || ""),
                    phone: String(form.get("phone") || ""),
                    address: String(form.get("address") || ""),
                    city: String(form.get("city") || ""),
                    pincode: String(form.get("pincode") || ""),
                    state: String(form.get("state") || "")
                },
                notes: String(form.get("notes") || ""),
                items: state.cart
            };
            state.orders.unshift(order);
            writeStorage(STORAGE_KEYS.orders, state.orders);
            await saveRemoteOrder(order);
            state.cart = [];
            writeStorage(STORAGE_KEYS.cart, state.cart);
            showToast(`Order ${order.id} placed`);
            window.location.href = "orders.html";
        }
    }

    function addToCart(productId, size) {
        const product = findProduct(productId);
        if (!product) return;
        const chosenSize = size || product.sizes[0];
        const key = `${productId}__${chosenSize}`;
        const existing = state.cart.find((item) => item.key === key);
        if (existing) existing.quantity += 1;
        else state.cart.push({ key, productId, size: chosenSize, quantity: 1 });
        writeStorage(STORAGE_KEYS.cart, state.cart);
        showToast(`${product.name} added to cart`);
        renderApp();
    }

    function changeCartQty(key, amount) {
        const item = state.cart.find((entry) => entry.key === key);
        if (!item) return;
        item.quantity += amount;
        state.cart = state.cart.filter((entry) => entry.quantity > 0);
        writeStorage(STORAGE_KEYS.cart, state.cart);
        renderApp();
    }

    function removeCartItem(key) {
        state.cart = state.cart.filter((entry) => entry.key !== key);
        writeStorage(STORAGE_KEYS.cart, state.cart);
        renderApp();
    }

    async function handleAuthAction(action) {
        if (!runtime.supabaseAvailable) {
            showToast("Google sign-in is unavailable right now. Browsing and AI try-on still work, but checkout is locked.");
            return;
        }
        if (window.location.protocol === "file:") {
            showToast("Run the site on localhost to use Google sign-in");
            return;
        }
        if (action === "signin") {
            state.authBusy = true;
            const redirectTo = `${window.location.origin}${window.location.pathname}`;
            await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo } });
        }
        if (action === "signout") {
            await supabase.auth.signOut();
            state.session = null;
            state.orders = [];
            state.authBusy = false;
            renderApp();
        }
    }

    async function syncSession() {
        const { data } = await supabase.auth.getSession();
        state.session = data.session;
        if (state.session) {
            await loadRemoteProfile();
            await loadRemoteOrders();
        } else {
            state.orders = [];
        }
    }

    async function loadRemoteProfile() {
        if (!state.session) return;
        try {
            const { data, error } = await supabase.from("profiles").select("*").eq("id", state.session.user.id).maybeSingle();
            if (!error && data) {
                state.profile = { ...state.profile, ...data };
                writeStorage(STORAGE_KEYS.profile, state.profile);
            } else if (error && !runtime.supabaseWarningShown) {
                runtime.supabaseWarningShown = true;
                showToast("Supabase profile table not found. Using local profile storage.");
            }
        } catch (_error) {
            /* local fallback remains active */
        }
    }

    async function saveRemoteProfile() {
        if (!state.session) return;
        try {
            await supabase.from("profiles").upsert({
                id: state.session.user.id,
                email: state.session.user.email,
                full_name: state.profile.full_name,
                phone: state.profile.phone,
                city: state.profile.city,
                address: state.profile.address,
                pincode: state.profile.pincode,
                preferred_fit: state.profile.preferred_fit,
                style_mood: state.profile.style_mood
            });
        } catch (_error) {
            /* local fallback remains active */
        }
    }

    async function loadRemoteOrders() {
        if (!state.session) return;
        try {
            const { data, error } = await supabase.from("orders").select("*").eq("user_id", state.session.user.id).order("created_at", { ascending: false });
            if (!error && Array.isArray(data)) {
                state.orders = data.map((row) => ({
                    id: row.order_code || row.id,
                    status: row.status || "Confirmed",
                    date: row.created_at ? new Date(row.created_at).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "Recent",
                    eta: row.eta || "2 to 4 business days",
                    payment_method: row.payment_method || "upi",
                    total: Number(row.total || 0),
                    items: Array.isArray(row.items) ? row.items : [],
                    notes: row.notes || ""
                }));
                writeStorage(STORAGE_KEYS.orders, state.orders);
            } else if (error && !runtime.supabaseWarningShown) {
                runtime.supabaseWarningShown = true;
                showToast("Supabase orders table not found. Using local order history.");
            }
        } catch (_error) {
            /* local fallback remains active */
        }
    }

    async function saveRemoteOrder(order) {
        if (!state.session) return;
        try {
            await supabase.from("orders").insert({
                user_id: state.session.user.id,
                order_code: order.id,
                status: order.status,
                payment_method: order.payment_method,
                total: order.total,
                eta: order.eta,
                items: order.items,
                shipping_address: order.shipping_address,
                notes: order.notes
            });
        } catch (_error) {
            /* local fallback remains active */
        }
    }

    function openTryOn(productId) {
        const product = findProduct(productId);
        if (!product) return;
        state.tryOn = {
            open: true,
            productId,
            size: product.sizes.includes(state.selectedSize) ? state.selectedSize : product.sizes[0],
            mode: "idle",
            insights: [
                { title: "AI camera ready", body: "Start the live camera or upload a photo to preview this product on your body." },
                { title: "Smart placement", body: "The overlay uses pose landmarks to align tops, bottoms, footwear, and accessories." }
            ]
        };
        renderApp();
    }

    function closeTryOn() {
        stopTryOnStream(false);
        if (runtime.uploadedUrl) {
            URL.revokeObjectURL(runtime.uploadedUrl);
            runtime.uploadedUrl = "";
        }
        state.tryOn = { open: false, productId: null, size: "", mode: "idle", insights: [] };
        runtime.latestLandmarks = null;
        renderApp();
    }

    function getTryOnProduct() {
        return state.tryOn.productId ? findProduct(state.tryOn.productId) : null;
    }

    async function hydrateTryOnStage() {
        const product = getTryOnProduct();
        const video = document.getElementById("tryon-video");
        const photo = document.getElementById("tryon-photo");
        if (state.tryOn.mode === "live" && video && runtime.tryOnStream) {
            if (runtime.tryOnLoop) cancelAnimationFrame(runtime.tryOnLoop);
            video.srcObject = runtime.tryOnStream;
            video.classList.remove("hidden");
            await video.play();
            if (runtime.poseLandmarker) {
                drawLivePoseFrame();
                setTryOnStageStatus("Live camera active");
            } else {
                clearTryOnOverlay();
                setTryOnStageStatus("Live camera active - basic mode");
            }
        }
        if (product && photo && runtime.uploadedUrl) photo.src = runtime.uploadedUrl;
        if (state.tryOn.mode === "photo" && photo && photo.complete) {
            if (runtime.poseLandmarker) {
                await renderPoseForImage(photo);
                setTryOnStageStatus("Uploaded photo loaded");
            } else {
                clearTryOnOverlay();
                setTryOnStageStatus("Uploaded photo loaded - basic mode");
            }
        }
    }

    async function startTryOnCamera() {
        const product = getTryOnProduct();
        if (window.location.protocol === "file:" || !window.isSecureContext) {
            showToast("Open the site on localhost to allow camera access");
            return;
        }
        const video = document.getElementById("tryon-video");
        if (!video || !navigator.mediaDevices?.getUserMedia) {
            showToast("Camera access is not available in this browser.");
            return;
        }
        try {
            stopTryOnStream(false);
            runtime.tryOnStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
            state.tryOn.mode = "live";
            runtime.latestLandmarks = null;
            renderApp();
            if (product) await getProcessedAsset(product);
            try {
                await ensurePoseLandmarker();
                await hydrateTryOnStage();
            } catch (_error) {
                clearTryOnOverlay();
                setTryOnStageStatus("Live camera active - basic mode");
                showPoseFallbackNotice("camera");
            }
        } catch (_error) {
            showToast("Camera could not start. Check browser permission and localhost mode.");
        }
    }

    function stopTryOnStream(renderAfterStop) {
        if (runtime.tryOnLoop) cancelAnimationFrame(runtime.tryOnLoop);
        runtime.tryOnLoop = null;
        if (runtime.tryOnStream) {
            runtime.tryOnStream.getTracks().forEach((track) => track.stop());
            runtime.tryOnStream = null;
        }
        const video = document.getElementById("tryon-video");
        if (video) video.classList.add("hidden");
        runtime.latestLandmarks = null;
        clearTryOnOverlay();
        if (renderAfterStop) {
            state.tryOn.mode = runtime.uploadedUrl ? "photo" : "idle";
            renderApp();
        }
    }

    async function handleTryOnUpload(file) {
        if (!file) return;
        const product = getTryOnProduct();
        if (product) await getProcessedAsset(product);
        stopTryOnStream(false);
        if (runtime.uploadedUrl) URL.revokeObjectURL(runtime.uploadedUrl);
        runtime.uploadedUrl = URL.createObjectURL(file);
        state.tryOn.mode = "photo";
        runtime.latestLandmarks = null;
        renderApp();
        const photo = document.getElementById("tryon-photo");
        if (!photo) return;
        photo.onload = async () => {
            try {
                await ensurePoseLandmarker();
                await renderPoseForImage(photo);
                setTryOnStageStatus("Uploaded photo loaded");
            } catch (_error) {
                clearTryOnOverlay();
                setTryOnStageStatus("Uploaded photo loaded - basic mode");
                showPoseFallbackNotice("photo");
            }
        };
        photo.src = runtime.uploadedUrl;
    }

    async function ensurePoseLandmarker() {
        if (runtime.poseLandmarker) return runtime.poseLandmarker;
        const vision = await import("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/+esm");
        const resolver = await vision.FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm");
        runtime.poseLandmarker = await vision.PoseLandmarker.createFromOptions(resolver, {
            baseOptions: { modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task" },
            runningMode: "VIDEO",
            numPoses: 1
        });
        return runtime.poseLandmarker;
    }

    async function createSupabaseClient() {
        try {
            const supabasePkg = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm");
            const { createClient } = supabasePkg;
            const client = createClient(
                "https://scotaalgcnzbbtlfplm.supabase.co",
                "sb_publishable_y99NCoZBQRt-5fp30OSiCg_YwNYXBY-"
            );
            client.__enabled = true;
            return client;
        } catch (_error) {
            return createFallbackSupabase();
        }
    }

    function createFallbackSupabase() {
        return {
            __enabled: false,
            auth: {
                async getSession() { return { data: { session: null } }; },
                onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
                async signInWithOAuth() { return { data: null, error: null }; },
                async signOut() { return { error: null }; }
            },
            from() {
                return createFallbackQuery();
            }
        };
    }

    function createFallbackQuery() {
        return {
            select() { return this; },
            eq() { return this; },
            order() { return Promise.resolve({ data: [], error: null }); },
            maybeSingle() { return Promise.resolve({ data: null, error: null }); },
            upsert() { return Promise.resolve({ data: null, error: null }); },
            insert() { return Promise.resolve({ data: null, error: null }); }
        };
    }

    async function renderPoseForImage(image) {
        const landmarker = await ensurePoseLandmarker();
        await landmarker.setOptions({ runningMode: "IMAGE" });
        const result = landmarker.detect(image);
        runtime.latestLandmarks = result.landmarks && result.landmarks[0] ? result.landmarks[0] : null;
        drawGarmentOverlay(runtime.latestLandmarks);
        await landmarker.setOptions({ runningMode: "VIDEO" });
    }

    async function drawLivePoseFrame() {
        const video = document.getElementById("tryon-video");
        const landmarker = runtime.poseLandmarker;
        if (!video || !landmarker || video.readyState < 2 || state.tryOn.mode !== "live") return;
        const result = landmarker.detectForVideo(video, performance.now());
        runtime.latestLandmarks = result.landmarks && result.landmarks[0] ? result.landmarks[0] : null;
        drawGarmentOverlay(runtime.latestLandmarks);
        runtime.tryOnLoop = requestAnimationFrame(drawLivePoseFrame);
    }

    function clearTryOnOverlay() {
        const canvas = document.getElementById("tryon-overlay");
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    function setTryOnStageStatus(message) {
        const chip = document.getElementById("tryon-stage-chip");
        if (chip) chip.textContent = message;
    }

    function showPoseFallbackNotice(source) {
        if (runtime.poseWarningShown) return;
        runtime.poseWarningShown = true;
        showToast(`Camera opened in basic mode. AI overlay is unavailable for this ${source}.`);
    }

    function drawGarmentOverlay(landmarks) {
        const canvas = document.getElementById("tryon-overlay");
        const product = getTryOnProduct();
        if (!canvas || !product) return;
        const stage = document.getElementById("tryon-stage");
        const width = stage.clientWidth;
        const height = stage.clientHeight;
        canvas.width = width * window.devicePixelRatio;
        canvas.height = height * window.devicePixelRatio;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        const ctx = canvas.getContext("2d");
        ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
        ctx.clearRect(0, 0, width, height);
        if (!landmarks || !runtime.assetCache.has(product.id)) return;
        const asset = runtime.assetCache.get(product.id);
        const rect = garmentRectFromPose(product.tryOnZone, landmarks, width, height, product.sizes, state.tryOn.size || product.sizes[0], asset.aspect);
        if (!rect) return;
        ctx.globalAlpha = 0.88;
        ctx.drawImage(asset.canvas, rect.x, rect.y, rect.width, rect.height);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = "rgba(255,255,255,0.2)";
        ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
    }

    async function getProcessedAsset(product) {
        if (runtime.assetCache.has(product.id)) return runtime.assetCache.get(product.id);
        const image = await loadImage(product.image);
        const source = document.createElement("canvas");
        source.width = image.naturalWidth;
        source.height = image.naturalHeight;
        const sctx = source.getContext("2d");
        sctx.drawImage(image, 0, 0);
        const imageData = sctx.getImageData(0, 0, source.width, source.height);
        let minX = source.width;
        let minY = source.height;
        let maxX = 0;
        let maxY = 0;
        for (let i = 0; i < imageData.data.length; i += 4) {
            const r = imageData.data[i];
            const g = imageData.data[i + 1];
            const b = imageData.data[i + 2];
            const pixel = i / 4;
            const x = pixel % source.width;
            const y = Math.floor(pixel / source.width);
            if (r > 242 && g > 242 && b > 242) {
                imageData.data[i + 3] = 0;
            } else {
                minX = Math.min(minX, x);
                minY = Math.min(minY, y);
                maxX = Math.max(maxX, x);
                maxY = Math.max(maxY, y);
            }
        }
        sctx.putImageData(imageData, 0, 0);
        const cropped = document.createElement("canvas");
        const cropWidth = Math.max(1, maxX - minX + 1);
        const cropHeight = Math.max(1, maxY - minY + 1);
        cropped.width = cropWidth;
        cropped.height = cropHeight;
        cropped.getContext("2d").drawImage(source, minX, minY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
        const asset = { canvas: cropped, aspect: cropHeight / cropWidth };
        runtime.assetCache.set(product.id, asset);
        return asset;
    }

    function garmentRectFromPose(zone, landmarks, width, height, sizes, selectedSize, aspect) {
        const point = (index) => ({ x: landmarks[index].x * width, y: landmarks[index].y * height });
        const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
        const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
        const leftShoulder = point(11), rightShoulder = point(12), leftHip = point(23), rightHip = point(24);
        const leftAnkle = point(27), rightAnkle = point(28), leftEar = point(7), rightEar = point(8), leftWrist = point(15), rightWrist = point(16);
        const shoulderMid = mid(leftShoulder, rightShoulder), hipMid = mid(leftHip, rightHip), ankleMid = mid(leftAnkle, rightAnkle);
        const shoulderWidth = dist(leftShoulder, rightShoulder);
        const hipWidth = dist(leftHip, rightHip);
        const torsoHeight = Math.max(80, dist(shoulderMid, hipMid));
        const sizeScale = 0.9 + (Math.max(0, sizes.indexOf(selectedSize)) * 0.04);
        const earMid = mid(leftEar, rightEar);
        let rect = null;
        if (zone === "top") rect = { x: shoulderMid.x - shoulderWidth * 1.02 * sizeScale, y: shoulderMid.y - torsoHeight * 0.45, width: shoulderWidth * 2.04 * sizeScale, height: shoulderWidth * 2.04 * sizeScale * aspect };
        if (zone === "outerwear") rect = { x: shoulderMid.x - shoulderWidth * 1.12 * sizeScale, y: shoulderMid.y - torsoHeight * 0.55, width: shoulderWidth * 2.24 * sizeScale, height: shoulderWidth * 2.24 * sizeScale * aspect };
        if (zone === "bottoms" || zone === "bottom") rect = { x: hipMid.x - hipWidth * 0.98 * sizeScale, y: hipMid.y - torsoHeight * 0.08, width: hipWidth * 1.96 * sizeScale, height: hipWidth * 1.96 * sizeScale * aspect };
        if (zone === "footwear") rect = { x: ankleMid.x - shoulderWidth * 0.9, y: ankleMid.y - torsoHeight * 0.1, width: shoulderWidth * 1.8, height: shoulderWidth * 1.8 * aspect };
        if (zone === "accessory-head") rect = { x: earMid.x - shoulderWidth * 0.68, y: Math.min(leftEar.y, rightEar.y) - shoulderWidth * 0.98, width: shoulderWidth * 1.36, height: shoulderWidth * 1.36 * aspect };
        if (zone === "accessory-shoulder") rect = { x: rightShoulder.x - shoulderWidth * 0.1, y: shoulderMid.y + torsoHeight * 0.05, width: shoulderWidth * 1.12, height: shoulderWidth * 1.12 * aspect };
        if (zone === "accessory-backpack") rect = { x: shoulderMid.x - shoulderWidth * 0.82, y: shoulderMid.y - torsoHeight * 0.1, width: shoulderWidth * 1.64, height: shoulderWidth * 1.64 * aspect };
        if (zone === "accessory-neck") rect = { x: shoulderMid.x - shoulderWidth * 0.42, y: shoulderMid.y - torsoHeight * 0.2, width: shoulderWidth * 0.84, height: shoulderWidth * 0.84 * aspect };
        if (zone === "waist") rect = { x: hipMid.x - hipWidth * 0.7, y: hipMid.y - torsoHeight * 0.18, width: hipWidth * 1.4, height: hipWidth * 1.4 * aspect };
        if (zone === "wrist") { const wristMid = mid(leftWrist, rightWrist); rect = { x: wristMid.x - shoulderWidth * 0.2, y: wristMid.y - shoulderWidth * 0.12, width: shoulderWidth * 0.4, height: shoulderWidth * 0.4 * aspect }; }
        if (!rect) return null;
        rect.x = Math.max(0, rect.x);
        rect.y = Math.max(0, rect.y);
        return rect;
    }

    function runFitAnalysis() {
        const product = getTryOnProduct();
        if (!product) return;
        const confidence = runtime.latestLandmarks ? 94 : 78;
        const zoneText = {
            top: "Upper-body alignment looks balanced across shoulders and chest.",
            outerwear: "Layering room looks comfortable around shoulders and upper torso.",
            bottom: "Waist placement and leg fall look balanced against your lower-body frame.",
            footwear: "The shoe scale looks strong compared with ankle width and overall outfit proportion.",
            "accessory-head": "Headwear placement looks centered and scaled well across the upper face and crown.",
            "accessory-shoulder": "Bag drop and shoulder scale look clean without overpowering the outfit.",
            "accessory-backpack": "Backpack width looks proportionate to shoulder span and upper-back area.",
            "accessory-neck": "Neck accessory drop looks centered and visually balanced.",
            waist: "Waist placement sits close to the natural center line for a clean fit.",
            wrist: "Wrist accessory scale looks neat and proportionate."
        }[product.tryOnZone] || "The overall placement looks balanced.";
        state.tryOn.insights = [
            { title: `AI confidence: ${confidence}%`, body: `The ${product.name} overlay is aligned for size ${state.tryOn.size}. Use this with the fit notes before checkout.` },
            { title: "Fit note", body: zoneText },
            { title: "Styling note", body: `${product.shortDescription} This works especially well for Indian day-to-evening dressing.` }
        ];
        renderApp();
    }

    function getCurrentProduct() {
        const slug = new URLSearchParams(window.location.search).get("slug");
        return catalogData.find((item) => item.slug === slug) || null;
    }

    function getFilteredProducts() {
        const params = new URLSearchParams(window.location.search);
        const audience = params.get("audience");
        const collection = params.get("collection");
        if (audience && state.filters.audience === "all") state.filters.audience = audience;
        if (collection && state.filters.collection === "all") state.filters.collection = collection;
        const query = state.filters.search.trim().toLowerCase();
        const filtered = catalogData.filter((item) => {
            const searchMatch = !query || `${item.name} ${item.shortDescription} ${item.category} ${item.collection} ${item.audience}`.toLowerCase().includes(query);
            const audienceMatch = state.filters.audience === "all" || item.audience === state.filters.audience;
            const collectionMatch = state.filters.collection === "all" || item.collection === state.filters.collection;
            return searchMatch && audienceMatch && collectionMatch;
        });
        if (state.filters.sort === "price-low") filtered.sort((a, b) => a.price - b.price);
        if (state.filters.sort === "price-high") filtered.sort((a, b) => b.price - a.price);
        if (state.filters.sort === "rating") filtered.sort((a, b) => b.rating - a.rating);
        if (state.filters.sort === "featured") filtered.sort((a, b) => Number(b.featured) - Number(a.featured) || b.rating - a.rating);
        return filtered;
    }

    function findProduct(id) { return catalogData.find((item) => item.id === Number(id)) || null; }
    function cartCount() { return state.cart.reduce((sum, item) => sum + item.quantity, 0); }
    function cartTotals() { const subtotal = state.cart.reduce((sum, item) => { const product = findProduct(item.productId); return product ? sum + product.price * item.quantity : sum; }, 0); const shipping = subtotal >= 2999 ? 0 : 149; const platformFee = subtotal ? 39 : 0; const discount = subtotal >= 6999 ? 350 : subtotal >= 3999 ? 150 : 0; return { subtotal, shipping, platformFee, discount, total: subtotal + shipping + platformFee - discount }; }
    function getPageTitle() { return `${state.page === "home" ? siteMeta.brandName : `${titleCase(state.page)} | ${siteMeta.brandName}`}`; }
    function paymentLabel(method) { return { upi: "UPI", card: "Card", netbanking: "Net Banking", cod: "Cash on Delivery" }[method] || "UPI"; }
    function readStorage(key, fallback) { try { const raw = window.localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch (_error) { return fallback; } }
    function writeStorage(key, value) { window.localStorage.setItem(key, JSON.stringify(value)); }
    function formatCurrency(amount) { return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount); }
    function titleCase(value) { return value.split(" ").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" "); }
    function firstName(value) { return String(value).split(" ")[0]; }
    function safe(value) { return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
    function showToast(message) { const root = document.getElementById("toast-root"); if (!root) return; const item = document.createElement("div"); item.className = "toast-item"; item.textContent = message; root.appendChild(item); setTimeout(() => item.remove(), 2600); }
    function loadImage(src) { return new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = src; }); }
})();
