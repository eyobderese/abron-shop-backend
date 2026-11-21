import { flashDealJson } from '../products/flash-deal';
export function categoryJson(row: any) {
  return {
    id: row.id,
    parent_id: row.parentId,
    slug: row.slug,
    name_en: row.nameEn,
    name_am: row.nameAm,
    name_or: row.nameOr,
    image_url: row.imageUrl,
    sort_order: row.sortOrder,
    is_active: row.isActive,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

export function productJson(row: any) {
  const validViews = Array.isArray(row.imageViews)
    ? row.imageViews.filter(
        (view: unknown) =>
          view &&
          !Array.isArray(view) &&
          typeof view === 'object' &&
          typeof (view as { url?: unknown }).url === 'string',
      )
    : [];
  const imageViews = validViews.length > 0
    ? validViews
    : (row.images ?? []).map((url: string, index: number) => ({
        url,
        label: ['front', 'back', 'side', 'detail', 'lifestyle'][index] ?? 'other',
      }));

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    product_type: row.productType ?? 'Product',
    name_am: row.nameAm,
    name_or: row.nameOr,
    description: row.description,
    description_am: row.descriptionAm,
    description_or: row.descriptionOr,
    category_id: row.categoryId,
    category: row.categoryLegacy,
    brand: row.brand,
    family_id: row.familyId,
    model_code: row.family?.modelCode ?? null,
    family_name: row.family?.displayName ?? null,
    color_name: row.colorName,
    color_code: row.colorCode,
    color_hex: row.colorHex,
    variant_sort_order: row.variantSort ?? 0,
    price: row.price,
    was_price: row.wasPrice,
    flash_price: row.flashPrice ?? null,
    flash_starts_at: row.flashStartsAt ?? null,
    flash_ends_at: row.flashEndsAt ?? null,
    flash_deal: flashDealJson(row),
    currency: row.currency ?? 'ETB',
    size_type: row.sizeType ?? 'NONE',
    sizes: row.sizes ?? [],
    images: row.images,
    image_views: imageViews,
    in_stock: row.inStock,
    featured_in_hero: row.featuredInHero ?? false,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    categories: row.category ? categoryJson(row.category) : null,
  };
}

export function inquiryJson(row: any) {
  return {
    id: row.id,
    product_id: row.productId,
    product_name: row.productName,
    full_name: row.fullName,
    phone: row.phone,
    telegram: row.telegram,
    selected_size: row.selectedSize,
    selected_color: row.selectedColor,
    message: row.message,
    status: row.status,
    source: row.source ?? 'website',
    quantity: row.quantity ?? 1,
    promo_code: row.promoCodeText ?? null,
    attribution_source: row.attributionSource ?? null,
    marketer: row.promoCode?.marketer
      ? { id: row.promoCode.marketer.id, name: row.promoCode.marketer.name }
      : null,
    list_price: num(row.listPrice),
    discount_amount: num(row.discountAmount),
    quoted_price: num(row.quotedPrice),
    currency: row.currency ?? null,
    final_amount: num(row.finalAmount),
    cancel_reason: row.cancelReason ?? null,
    cancel_note: row.cancelNote ?? null,
    confirmed_at: row.confirmedAt ?? null,
    delivered_at: row.deliveredAt ?? null,
    cancelled_at: row.cancelledAt ?? null,
    customer_on_telegram: Boolean(row.customerChatId),
    customer_confirmation: row.customerConfirmation ?? null,
    commission: row.commission
      ? {
          amount: num(row.commission.amount),
          status: row.commission.status,
          is_penalty: row.commission.isPenalty,
          eligible_at: row.commission.eligibleAt,
        }
      : null,
    open_disputes: Array.isArray(row.disputes) ? row.disputes.length : 0,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

function num(value: { toString(): string } | null | undefined) {
  return value === null || value === undefined ? null : Number(value.toString());
}

export function adJson(row: any) {
  return {
    id: row.id,
    title: row.title,
    media_url: row.mediaUrl,
    media_type: row.mediaType,
    poster_url: row.posterUrl,
    link_url: row.linkUrl,
    placement: row.placement,
    category_id: row.categoryId,
    sort_order: row.sortOrder,
    is_active: row.isActive,
    starts_at: row.startsAt,
    ends_at: row.endsAt,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}
