<script setup>
const props = defineProps({
  item: {
    type: Object,
    required: true
  }
});

const emit = defineEmits(['view', 'edit', 'remove']);

const buttons = [
  {
    label: 'View',
    action: () => emit('view', props.item)
  },
  {
    label: 'Edit',
    action: () => emit('edit', props.item)
  },
  {
    label: 'Remove',
    action: () => emit('remove', props.item)
  }
];
</script>

<template>
  <HeadlessMenu as="div">
    <HeadlessMenuButton class="align-middle" @click.stop>
      <i-heroicons-ellipsis-vertical class="w-5 h-5 text-gray-500"></i-heroicons-ellipsis-vertical>
    </HeadlessMenuButton>
    <HeadlessMenuItems class="absolute right-10 z-10 bg-white flex flex-col border rounded">
      <HeadlessMenuItem v-for="(button, index) in buttons" :key="index" v-slot="{ active }">
        <button class="py-2 px-4" :class="{ 'bg-blue-500': active }" @click.stop="button.action">
          {{ button.label }}
        </button>
      </HeadlessMenuItem>
    </HeadlessMenuItems>
  </HeadlessMenu>
</template>
