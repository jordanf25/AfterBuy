import type { CollectionSchema } from 'deepspace/schema'

export const purchasesSchema: CollectionSchema = {
  name: 'purchases',
  columns: [
    { name: 'productName', storage: 'text', interpretation: 'plain' },
    { name: 'retailer', storage: 'text', interpretation: 'plain' },
    { name: 'price', storage: 'number', interpretation: 'plain' },
    { name: 'purchaseDate', storage: 'text', interpretation: 'plain' },
    { name: 'receiptFileKey', storage: 'text', interpretation: 'plain' },
    { name: 'returnDeadline', storage: 'text', interpretation: 'plain' },
    { name: 'deadlineSource', storage: 'text', interpretation: 'plain' },
    { name: 'returnWindowDays', storage: 'number', interpretation: 'plain' },
  ],
  permissions: {
    viewer: { read: false, create: false, update: false, delete: false },
    member: { read: 'own', create: true, update: 'own', delete: 'own' },
    admin: { read: true, create: true, update: true, delete: true },
  },
}