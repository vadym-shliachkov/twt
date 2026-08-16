<template>
  <section class="hero">
    <h1 class="hero__title">{{ title }}</h1>
    <p class="hero__lede">{{ lede }}</p>
    <a class="hero__cta" :href="href">{{ cta }}</a>
  </section>
</template>

<script setup>
defineProps({
  title: { type: String, required: true },
  lede: { type: String, default: '' },
  cta: { type: String, default: 'Get started' },
  href: { type: String, default: '#' },
});
</script>
