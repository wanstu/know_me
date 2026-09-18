import {
  createTaxonomy,
  deletePost,
  deleteTaxonomy,
  getPostById,
  listTaxonomyDetails,
  renameTaxonomy,
  savePost
} from "../lib/blog/repository";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const suffix = Date.now().toString();
const tagName = "taxonomy-smoke-tag-" + suffix;
const categoryName = "taxonomy-smoke-category-" + suffix;
const renamedTag = tagName + "-renamed";

let tagId = 0;
let categoryId = 0;
let postId = 0;

try {
  tagId = createTaxonomy("tag", tagName);
  categoryId = createTaxonomy("category", categoryName);

  let details = listTaxonomyDetails();
  assert(details.tags.some((item) => item.id === tagId && item.count === 0), "new tag missing");
  assert(details.categories.some((item) => item.id === categoryId && item.count === 0), "new category missing");

  const post = savePost({
    title: "Taxonomy Smoke " + suffix,
    slug: "taxonomy-smoke-" + suffix,
    contentMd: "# Taxonomy smoke",
    status: "draft",
    tags: [tagName],
    categories: [categoryName]
  });
  postId = post.id;

  details = listTaxonomyDetails();
  assert(details.tags.find((item) => item.id === tagId)?.count === 1, "tag relation count incorrect");
  assert(details.categories.find((item) => item.id === categoryId)?.count === 1, "category relation count incorrect");

  renameTaxonomy("tag", tagId, renamedTag);
  const renamedPost = getPostById(postId);
  assert(renamedPost?.tags.includes(renamedTag), "tag rename did not preserve relation");

  deleteTaxonomy("tag", tagId);
  tagId = 0;
  const afterDelete = getPostById(postId);
  assert(afterDelete && afterDelete.tags.length === 0, "tag delete did not clear relation");

  console.log("taxonomy smoke: PASS");
} finally {
  if (postId) deletePost(postId);
  if (tagId) deleteTaxonomy("tag", tagId);
  if (categoryId) deleteTaxonomy("category", categoryId);
}
