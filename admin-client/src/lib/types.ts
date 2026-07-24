export interface Page<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface FoodNutrition {
  calories: number | null;
  servings: number | null;
  protein: number | null;
  fat: number | null;
  carbs: number | null;
}

export interface FoodTags {
  allergens: string[];
  dietaryRestrictions: string[];
  intolerances: string[];
  features: string[];
  diets: string[];
}

export interface Food {
  id: string;
  name: string;
  description: string | null;
  cuisine: string | null;
  images: string[];
  nutrition: FoodNutrition | null;
  tags: FoodTags;
  createdAt: string;
  updatedAt: string;
}

export interface FoodFormOptions {
  cuisines: string[];
  diets: string[];
  allergens: string[];
  dietaryRestrictions: string[];
  intolerances: string[];
  features: string[];
  foodDiets: string[];
}

export interface AdminUserListItem {
  id: string;
  username: string;
  email: string | null;
  emailVerified: boolean;
  imageUrl: string | null;
  name: string | null;
  isBanned: boolean;
  bannedAt: string | null;
  createdAt: string;
}

export interface AdminUserDetail extends AdminUserListItem {
  age: number | null;
  status: string | null;
  description: string | null;
  interactionCount: number;
  complaintsAgainstCount: number;
  complaintsFiledCount: number;
}

export type ComplaintStatus = 'OPEN' | 'RESOLVED' | 'DISMISSED';
export type ComplaintTargetType = 'USER' | 'FOOD';

export interface Complaint {
  id: string;
  targetType: ComplaintTargetType;
  reason: string;
  status: ComplaintStatus;
  createdAt: string;
  resolvedAt: string | null;
  reporter: { id: string; username: string };
  targetUser: { id: string; username: string } | null;
  targetFood: { id: string; name: string } | null;
  resolvedByAdmin: { id: string; name: string } | null;
}
