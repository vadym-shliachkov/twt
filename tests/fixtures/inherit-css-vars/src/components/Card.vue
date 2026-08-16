<template>
  <article class="card">
    <h3 class="card__title">{{ title }}</h3>
    <p class="card__body"><slot /></p>
  </article>
</template>

<script setup>
defineProps({ title: { type: String, required: true } });
</script>
