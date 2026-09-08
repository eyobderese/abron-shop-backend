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
    name_am: row.nameAm,
    name_or: row.nameOr,
    description: row.description,
    description_am: row.descriptionAm,
    description_or: row.descriptionOr,
    category_id: row.categoryId,
    category: row.categoryLegacy,
    brand: row.brand,
    price: row.price,
    was_price: row.wasPrice,
    currency: row.currency ?? 'ETB',
    images: row.images,
    image_views: imageViews,
    in_stock: row.inStock,
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
    message: row.message,
    status: row.status,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
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
