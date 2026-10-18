type Refusal<Message extends string> = { readonly [Text in Message]: never };

/** What a declaration must also satisfy: each field it holds is one its kind declares. */
export type DeclaredFieldsRule<Declaration, Shape> = {
  readonly [Field in Exclude<
    keyof Declaration,
    keyof Shape
  >]: Refusal<`${Field & string} is not a declared field`>;
};
