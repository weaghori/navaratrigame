document.querySelectorAll('[data-navratri-treasure]').forEach((block) => {
  if (block.dataset.treasureInitialized === 'true') return;
  block.dataset.treasureInitialized = 'true';
  const button = block.querySelector('[data-treasure-claim]');
  const message = block.querySelector('[data-treasure-message]');
  const label = block.querySelector('[data-treasure-label]');
  const icon = block.querySelector('[data-treasure-icon]');
  const routeRoot = window.Shopify?.routes?.root || '/';
  const appProxyPath = `${routeRoot.replace(/\/?$/, '/')}apps/navratri/api/treasure`;
  const configUrl = new URL(appProxyPath, window.location.origin);
  const pageParams = new URLSearchParams(window.location.search);
  let campaignSlug = pageParams.get('navratri_campaign') || block.dataset.campaignSlug;
  let levelNumber = pageParams.get('navratri_level') || block.dataset.levelNumber;
  configUrl.searchParams.set('campaignSlug', campaignSlug);
  configUrl.searchParams.set('levelNumber', levelNumber);

  const pagePath = decodeURIComponent(window.location.pathname);
  const productHandle = block.dataset.productHandle || pagePath.match(/\/products\/([^/?#]+)/)?.[1] || '';
  const collectionHandle = pagePath.match(/\/collections\/([^/?#]+)/)?.[1] || '';
  if (!productHandle && !collectionHandle) {
    block.hidden = true;
    return;
  }

  const placeTreasure = () => {
    const rect = block.getBoundingClientRect();
    const margin = 14;
    const maxLeft = Math.max(margin, window.innerWidth - rect.width - margin);
    const maxTop = Math.max(margin, window.innerHeight - rect.height - margin);
    const sideInset = Math.min(36, Math.max(0, (maxLeft - margin) * 0.18));
    const verticalInset = Math.min(42, Math.max(0, (maxTop - margin) * 0.18));
    const onLeft = Math.random() < 0.5;
    const onTop = Math.random() < 0.5;
    const horizontalOffset = Math.floor(margin + Math.random() * sideInset);
    if (onLeft) {
      block.style.left = `${horizontalOffset}px`;
      block.style.right = 'auto';
    } else {
      block.style.left = 'auto';
      block.style.right = `${horizontalOffset}px`;
    }
    if (onTop) {
      block.style.top = `${Math.floor(margin + Math.random() * verticalInset)}px`;
      block.style.bottom = 'auto';
    } else {
      block.style.top = 'auto';
      block.style.bottom = '100px';
    }
  };

  const showTreasure = () => {
    block.hidden = false;
    placeTreasure();
  };

  if (window.Shopify?.designMode) {
    showTreasure();
    button.disabled = true;
    label.textContent = 'Find the Navratri treasure';
    button.setAttribute('aria-label', label.textContent);
    message.textContent = '';
    return;
  }

  fetch(configUrl, { credentials: 'same-origin' })
    .then(async (response) => {
      if (!response.ok) throw new Error(`Treasure settings returned ${response.status}`);
      return response.json();
    })
    .then((config) => {
      if (!config.success) throw new Error(config.error || 'Treasure hunt is unavailable.');
      campaignSlug = config.campaignSlug || campaignSlug;
      levelNumber = String(config.levelNumber || levelNumber);
      const products = (config.eligibleProductHandles || []).map((handle) => String(handle).toLowerCase());
      const categories = (config.eligibleCategories || []).map((handle) => String(handle).toLowerCase());
      const productMatches = products.includes(String(productHandle).toLowerCase());
      const currentCollections = [collectionHandle, ...(block.dataset.collectionHandles || '').split(',')]
        .map((handle) => handle.trim().toLowerCase()).filter(Boolean);
      const categoryMatches = currentCollections.some((handle) => categories.includes(handle));
      const hasTargetRules = products.length > 0 || categories.length > 0;
      const eligible = !hasTargetRules || (products.length && categories.length
        ? productMatches || categoryMatches
        : products.length ? productMatches : categoryMatches);
      if (!eligible) {
        block.hidden = true;
        return;
      }

      if (config.completed) {
        block.hidden = true;
        return;
      }
      showTreasure();
      block.dataset.eligibleCollectionHandle = currentCollections.find((handle) => categories.includes(handle)) || '';
      icon.textContent = config.buttonIcon || '🎁';
      label.textContent = config.buttonLabel || 'Find the Navratri treasure';
      button.setAttribute('aria-label', label.textContent);
      button.title = label.textContent;
      button.disabled = false;
    })
    .catch(() => {
      // Keep the hunt visible even if settings need attention; clicking still asks the server to verify it.
      showTreasure();
      label.textContent = 'Find the Navratri treasure';
      button.setAttribute('aria-label', label.textContent);
      button.title = label.textContent;
      button.disabled = false;
      message.textContent = '';
    });

  window.addEventListener('resize', placeTreasure, { passive: true });
  button.addEventListener('click', async () => {
    button.disabled = true;
    message.textContent = 'Checking your treasure…';
    const body = new URLSearchParams({
      campaignSlug,
      levelNumber,
      productHandle,
      collectionHandle: block.dataset.eligibleCollectionHandle || collectionHandle,
    });
    try {
      const response = await fetch(configUrl.pathname, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body,
        credentials: 'same-origin',
      });
      const result = await response.json();
      message.textContent = result.message || result.error || (response.ok ? 'Treasure found!' : 'Please sign in and try again.');
      if (result.success) {
        icon.textContent = '✓';
        label.textContent = 'Treasure claimed';
        button.setAttribute('aria-label', label.textContent);
        window.setTimeout(() => {
          block.hidden = true;
          const campaignPath = `${routeRoot.replace(/\/?$/, '/')}apps/navratri/campaigns/${encodeURIComponent(campaignSlug)}`;
          window.location.assign(new URL(campaignPath, window.location.origin).toString());
        }, 900);
      } else {
        button.disabled = false;
      }
    } catch {
      message.textContent = 'Could not verify the treasure. Please try again.';
      button.disabled = false;
    }
  });
});
